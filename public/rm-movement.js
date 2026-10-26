(() => {
  const money = (value) =>
    Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

  const formatMoney = (value) =>
    money(value).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });

  document.querySelectorAll('.rm-movement').forEach((root) => {
    const buttons = [...root.querySelectorAll('.rm-tabs [data-tab]')];
    const panels = [...root.querySelectorAll('.rm-tab-panel[data-panel]')];
    const requested = new URLSearchParams(location.search).get('tab');

    function activate(name, updateUrl = true) {
      const target = panels.find(
        (panel) => panel.dataset.panel === name
      );

      if (!target) return;

      buttons.forEach((button) => {
        const active = button.dataset.tab === name;

        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
      });

      panels.forEach((panel) => {
        panel.classList.toggle('active', panel === target);
      });

      if (updateUrl) {
        const url = new URL(location.href);

        url.searchParams.set('tab', name);
        history.replaceState({}, '', url);
      }
    }

    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        activate(button.dataset.tab);
      });
    });

    activate(requested || buttons[0]?.dataset.tab, false);

    root.querySelectorAll('[data-money-calc]').forEach((section) => {
      const quantity = section.querySelector('[name="quantity"]');
      const unitPrice = section.querySelector(
        '[name="unit_price"], [name="unitPrice"]'
      );
      const discount = section.querySelector('[name="discount"]');
      const output = section.querySelector('[data-item-total]');

      const recalculate = () => {
        const total = Math.max(
          0,
          money(
            Number(quantity?.value || 0) *
              Number(unitPrice?.value || 0) -
              Number(discount?.value || 0)
          )
        );

        if (output) {
          output.textContent = formatMoney(total);
        }
      };

      [quantity, unitPrice, discount]
        .filter(Boolean)
        .forEach((input) => {
          input.addEventListener('input', recalculate);
        });

      recalculate();
    });

    const rows = root.querySelectorAll(
      '.rm-data-grid tbody tr[data-row-id]'
    );

    rows.forEach((row) => {
      row.addEventListener('click', () => {
        rows.forEach((item) => {
          item.classList.remove('selected');
        });

        row.classList.add('selected');

        root.dispatchEvent(
          new CustomEvent('rm:row-selected', {
            detail: {
              id: row.dataset.rowId
            }
          })
        );
      });
    });
  });
})();
