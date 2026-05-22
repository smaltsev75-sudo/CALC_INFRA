import { el } from './dom.js';
import { DEFAULT_PROVIDER, listProviders } from '../domain/providerOverlay.js';
import {
    renderProviderUpdateRow,
    renderProviderPriceSummary
} from './providerPriceSummary.js';

/* ---------- 14.U4 / 14.U8: Provider dropdown ----------
   Глобальная настройка расчёта — провайдер облака. Влияет на overlay-цены
   (применяются при расчёте через applyProviderOverlay в calculator.js).
   Хранится в calc.settings.provider; флаг calc.settings.providerSetByWizard
   используется только UI'ем для бейджа источника.

   Активные провайдеры (14.U8): Cloud.ru (id sbercloud для совместимости),
   Yandex Cloud и VK Cloud. Inactive (показаны как «(скоро)» в dropdown):
   On-prem (другая модель — CAPEX, а не overlay). */
export function renderProviderField(s, state, ctx) {
    const current  = s.provider || DEFAULT_PROVIDER;
    const setByWiz = !!s.providerSetByWizard;
    const providers = listProviders();
    /* Видимый текст под полем — одна строка ≤90 символов, чтобы поместиться
       в .settings-group-provider .field-description (max-width расширен до 800px).
       Простой язык, без жаргона «подменяет». Полная справка про ребрендинг
       Cloud.ru, Yandex/VK и stub On-prem — в hover-tooltip'е (title),
       не на постоянно занятом месте. Scope-фраза «все сценарии» во второй
       части — страховка против ошибочного ожидания «сменю провайдера в
       сценарии Б — сравню с А». */
    const tooltipShort = 'Цены берутся из тарифов выбранного провайдера. Действуют на весь расчёт — все сценарии.';
    const tooltipFull = tooltipShort + ' ' +
        'Cloud.ru (бывший SberCloud) — это одна и та же платформа: ребрендинг 2024 года, ' +
        'тарифы и API идентичны. Yandex Cloud — проверенный официальный прайс 22.05.2026. ' +
        'VK Cloud — публичный прайс с явными пробелами: WAF — защита веб-приложений, DDoS — защита от распределённых атак; эти цены у VK по запросу. Собственная инфраструктура (on-premise) — в следующих обновлениях.';

    /* Бейдж источника — рядом с label. Палитра совпадает с .field-source-badge
       из forms.css (этап 14.U2): зелёный для wizard-источника, outlined dashed
       для ручной правки. */
    const sourceBadge = el('span', {
        class: ['field-source-badge', `field-source-badge--${setByWiz ? 'wizard' : 'manual'}`],
        attrs: { title: setByWiz
            ? 'Провайдер был выбран автоматически в Quick Start. Изменить — вручную ниже.'
            : 'Провайдер изменён вручную в Опроснике (приоритет над Quick Start).' },
        text: setByWiz ? 'Из мастера' : 'Вы изменили'
    });

    return el('div', { class: 'settings-group settings-group-provider' },
        el('div', { class: 'settings-group-title', text: 'Облачный провайдер' }),
        el('div', { class: 'settings-grid' },
            el('label', { class: 'field' },
                el('span', { class: 'field-label', title: tooltipFull },
                    el('span', { class: 'field-label-text', text: 'Провайдер облака' }),
                    sourceBadge
                ),
                el('select', {
                    class: 'input',
                    title: tooltipFull,
                    attrs: {
                        'data-focus-key': 'setting:provider',
                        'data-testid': 'setting-provider'
                    },
                    onChange: e => {
                        const v = e.target.value;
                        /* Disabled-опции отбрасываем (browser обычно не даёт их
                           выбрать, но защищаемся на уровне controller'а). */
                        const target = providers.find(p => p.id === v);
                        if (target && target.active) ctx.setProvider(v);
                    }
                },
                    ...providers.map(p => el('option', {
                        value: p.id,
                        attrs: {
                            disabled: p.active ? undefined : 'disabled',
                            selected: p.id === current ? 'selected' : undefined,
                            title: p.description
                        }
                    }, p.active ? p.label : `${p.label} (скоро)`))
                ),
                renderProviderUpdateRow(current, state, ctx),
                renderProviderPriceSummary(current, state, ctx),
                el('span', { class: 'field-description', text: tooltipShort })
            )
        )
    );
}
