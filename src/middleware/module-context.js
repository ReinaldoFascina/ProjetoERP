import { systemModules } from "../config/modules.js";

const ROUTE_MODULES = [
  {
    key: "stock",
    paths: [
      "/stock-management",
      "/billing",
      "/catalog",
      "/purchases",
      "/clients",
    ],
  },
  {
    key: "accounting",
    paths: [
      "/accounting",
    ],
  },
  {
    key: "empr",
    paths: [
      "/real-estate",
    ],
  },
  {
    key: "fiscal",
    paths: [
      "/fiscal",
      "/nfse",
      "/nfse-national",
    ],
  },
  {
    key: "finance",
    paths: [
      "/finance",
      "/cash-accounts",
      "/cash-extract",
      "/reconciliation",
      "/payment-methods",
      "/reports/financial",
      "/reports/billing",
    ],
  },
  {
    key: "production",
    paths: ["/production"],
  },
  {
    key: "assets",
    paths: ["/assets"],
  },
  {
    key: "maintenance",
    paths: ["/maintenance"],
  },
  {
    key: "expimpo",
    paths: ["/comex"],
  },
  {
    key: "technical",
    paths: [
      "/dashboardTickets",
      "/tickets",
      "/agenda",
      "/rats",
      "/technicians",
      "/users",
    ],
  },
];

const MODULE_NEUTRAL_PATHS = [
  "/login",
  "/logout",
  "/health",
  "/modules",
  "/company-context",
  "/rat-approval",
];

function pathMatches(currentPath, basePath) {
  return (
    currentPath === basePath ||
    currentPath.startsWith(`${basePath}/`)
  );
}

function isModuleNeutralPath(currentPath) {
  return MODULE_NEUTRAL_PATHS.some((basePath) =>
    pathMatches(currentPath, basePath)
  );
}

function requestedModuleForPath(currentPath) {
  if (currentPath === "/") {
    return "technical";
  }

  if (isModuleNeutralPath(currentPath)) {
    return null;
  }

  const match = ROUTE_MODULES.find(({ paths }) =>
    paths.some((basePath) => pathMatches(currentPath, basePath))
  );

  return match?.key || null;
}

function canAccessModule(user, moduleKey) {
  if (!user || !moduleKey) {
    return false;
  }

  const module = systemModules[moduleKey];

  return Boolean(
    module &&
    Array.isArray(module.roles) &&
    module.roles.includes(user.role)
  );
}

function firstAllowedModuleKey(user) {
  if (!user) {
    return "technical";
  }

  return (
    Object.values(systemModules).find(
      (module) =>
        Array.isArray(module.roles) &&
        module.roles.includes(user.role)
    )?.key || "technical"
  );
}

export function moduleContext(req, res, next) {
  try {
    const user = req.session?.user || null;
    const currentPath = req.path || "/";
    const requestedModule = requestedModuleForPath(currentPath);

    if (
      requestedModule &&
      canAccessModule(user, requestedModule)
    ) {
      req.session.activeModule = requestedModule;
    }

    let activeModuleKey =
      req.session?.activeModule || firstAllowedModuleKey(user);

    if (
      !systemModules[activeModuleKey] ||
      (user && !canAccessModule(user, activeModuleKey))
    ) {
      activeModuleKey = firstAllowedModuleKey(user);

      if (req.session) {
        req.session.activeModule = activeModuleKey;
      }
    }

    res.locals.user = user;
    res.locals.activeModule =
      systemModules[activeModuleKey] || systemModules.technical;
    res.locals.companyContext =
      res.locals.companyContext || null;
    res.locals.message =
      typeof req.query?.message === "string"
        ? req.query.message
        : "";
    res.locals.error =
      typeof req.query?.error === "string"
        ? req.query.error
        : "";

    return next();
  } catch (error) {
    return next(error);
  }
}
