export function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.redirect("/login");
  }

  return next();
}

export function allow(...roles) {
  return function allowRoles(req, res, next) {
    /*
     * Não responda novamente aqui se o usuário não estiver
     * autenticado. O requireAuth deve ser executado antes.
     */
    if (!req.session?.user) {
      return res.redirect("/login");
    }

    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render("error", {
        message:
          "Você não possui permissão para acessar esta funcionalidade.",
      });
    }

    return next();
  };
}