import { logger } from "./logger.js";

// ========== Todo4-6：基础监控——请求耗时与任务成功率（内存计数，进程重启清零） ==========

export interface RouteStat {
  count: number;
  errors: number; // 状态码 >= 400
  totalMs: number;
  maxMs: number;
}

export interface TaskStats {
  success: number;
  stopped: number; // 达到最大轮次
  failed: number; // 异常终止
}

const routes = new Map<string, RouteStat>();
const tasks: TaskStats = { success: 0, stopped: 0, failed: 0 };
const startedAt = Date.now();

// 会话 ID 这类动态段归并成 :id，避免指标基数爆炸（仅在拿不到路由模板时兜底）
const normalizeRoute = (url: string): string => {
  const path = url.split("?")[0];
  return path
    .split("/")
    .map((seg) => (/^[a-z0-9-]{8,}$/i.test(seg) ? ":id" : seg))
    .join("/");
};

// 优先用 Express 路由模板（req.baseUrl + req.route.path，精确无歧义）；
// 未匹配路由（404/静态资源）时回退到 URL 启发式归并（实测 "sessions" 曾被误判成 :id）
export const routeKeyOf = (req: {
  baseUrl?: string;
  originalUrl: string;
  route?: { path?: string };
}): string =>
  req.route?.path !== undefined
    ? `${req.baseUrl ?? ""}${req.route.path}`
    : normalizeRoute(req.originalUrl);

export const recordRequest = (url: string, statusCode: number, ms: number): void => {
  const route = url;
  const stat = routes.get(route) ?? { count: 0, errors: 0, totalMs: 0, maxMs: 0 };
  stat.count++;
  if (statusCode >= 400) stat.errors++;
  stat.totalMs += ms;
  stat.maxMs = Math.max(stat.maxMs, ms);
  routes.set(route, stat);
};

export const recordTask = (outcome: keyof TaskStats): void => {
  tasks[outcome]++;
};

export const getMetrics = (): {
  uptimeSec: number;
  totalRequests: number;
  totalErrors: number;
  tasks: TaskStats & { total: number; successRate: number };
  routes: { route: string; count: number; errors: number; avgMs: number; maxMs: number }[];
} => {
  let totalRequests = 0;
  let totalErrors = 0;
  const routeList = [...routes.entries()]
    .map(([route, s]) => {
      totalRequests += s.count;
      totalErrors += s.errors;
      return {
        route,
        count: s.count,
        errors: s.errors,
        avgMs: Math.round(s.totalMs / s.count),
        maxMs: s.maxMs,
      };
    })
    .sort((a, b) => b.count - a.count);
  const taskTotal = tasks.success + tasks.stopped + tasks.failed;
  return {
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    totalRequests,
    totalErrors,
    tasks: {
      ...tasks,
      total: taskTotal,
      successRate: taskTotal === 0 ? 1 : Number((tasks.success / taskTotal).toFixed(4)),
    },
    routes: routeList,
  };
};

// 周期性打印监控快照（默认 5 分钟一次，随进程退出）
let timer: NodeJS.Timeout | null = null;
export const startMetricsReporter = (intervalMs = 5 * 60 * 1000): void => {
  if (timer) return;
  timer = setInterval(() => {
    const m = getMetrics();
    logger.info(
      "METRICS",
      `快照 请求=${m.totalRequests}(错${m.totalErrors}) 任务=${m.tasks.total}(成功率${(m.tasks.successRate * 100).toFixed(1)}%) 运行=${m.uptimeSec}s`
    );
  }, intervalMs);
  timer.unref?.();
};
