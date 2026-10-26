(() => {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('menuOverlay');
  const mobileButton = document.getElementById('mobileMenuButton');
  const collapseButton = document.getElementById('collapseMenuButton');
  const storageKey = 'serviceflow-sidebar-collapsed';

  if (!sidebar) return;

  const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

  function setMobileMenu(open) {
    sidebar.classList.toggle('mobile-open', open);
    if (overlay) overlay.hidden = !open;
    document.body.classList.toggle('menu-open', open);
    mobileButton?.setAttribute('aria-expanded', String(open));
  }

  function setCollapsed(collapsed) {
    if (isMobile()) return;
    sidebar.classList.toggle('collapsed', collapsed);
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    collapseButton?.setAttribute('aria-expanded', String(!collapsed));
    collapseButton?.setAttribute(
      'aria-label',
      collapsed ? 'Expandir menu' : 'Recolher menu'
    );
    localStorage.setItem(storageKey, String(collapsed));
  }

  mobileButton?.addEventListener('click', () => {
    setMobileMenu(!sidebar.classList.contains('mobile-open'));
  });

  overlay?.addEventListener('click', () => setMobileMenu(false));

  collapseButton?.addEventListener('click', () => {
    setCollapsed(!sidebar.classList.contains('collapsed'));
  });

  document.querySelectorAll('.submenu-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      if (sidebar.classList.contains('collapsed') && !isMobile()) {
        setCollapsed(false);
      }

      const group = button.closest('.nav-group');
      const willOpen = !group.classList.contains('open');

      document.querySelectorAll('.nav-group.open').forEach((openGroup) => {
        if (openGroup !== group) {
          openGroup.classList.remove('open');
          openGroup.querySelector('.submenu-toggle')?.setAttribute('aria-expanded', 'false');
        }
      });

      group.classList.toggle('open', willOpen);
      button.setAttribute('aria-expanded', String(willOpen));
    });
  });

  const currentPath = window.location.pathname.replace(/\/$/, '') || '/';
  let bestMatch = null;

  document.querySelectorAll('[data-path]').forEach((link) => {
    const linkPath = link.dataset.path.replace(/\/$/, '') || '/';
    const matches = linkPath === '/'
      ? currentPath === '/'
      : currentPath === linkPath || currentPath.startsWith(`${linkPath}/`);

    if (matches && (!bestMatch || linkPath.length > bestMatch.dataset.path.length)) {
      bestMatch = link;
    }
  });

  if (bestMatch) {
    bestMatch.classList.add('active');
    const group = bestMatch.closest('.nav-group');
    if (group) {
      group.classList.add('open');
      group.querySelector('.submenu-toggle')?.setAttribute('aria-expanded', 'true');
    }
  }

  if (!isMobile() && localStorage.getItem(storageKey) === 'true') {
    setCollapsed(true);
  }

  window.addEventListener('resize', () => {
    if (!isMobile()) setMobileMenu(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setMobileMenu(false);
  });
})();
