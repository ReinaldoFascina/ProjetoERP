import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { modulesForRole, systemModules } from '../config/modules.js';

export const modulesRouter = Router();

modulesRouter.get('/modules', requireAuth, (req, res) => {
  res.render('modules/index', {
    pageTitle: 'Módulos do sistema',
    modules: modulesForRole(req.session.user.role),
  });
});

modulesRouter.get('/modules/:key', requireAuth, (req, res) => {
  const module = systemModules[req.params.key];
  if (!module || !module.roles.includes(req.session.user.role)) {
    return res.status(403).render('error', { message: 'Módulo não disponível para o seu perfil.' });
  }
  req.session.activeModule = module.key;
  res.redirect(module.home);
});
