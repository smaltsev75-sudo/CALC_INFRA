/**
 * Вкладка «Вопросы».
 *
 * 12.U29: для каждой секции — accordion. По умолчанию ВСЕ секции свёрнуты,
 * пользователь явно раскрывает интересующие. Заголовок секции — clickable
 * <button> с chevron + счётчиком.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { SECTION_IDS, SECTION_LABELS, QUESTION_TYPE_LABELS } from '../utils/constants.js';

/**
 * Секция свёрнута, если она:
 *   - присутствует в state.ui.questionsCollapsedSecs (массив явно записан), ИЛИ
 *   - массива нет (null) — дефолт «всё свёрнуто».
 */
function isSectionCollapsed(secId, state) {
    const collapsed = state.ui?.questionsCollapsedSecs;
    if (collapsed === null || collapsed === undefined) return true;
    return collapsed.includes(secId);
}

export function renderQuestionsTab(state, ctx) {
    const calc = state.activeCalc;
    if (!calc) return el('div', { class: 'tab-pane' }, el('p', { text: 'Создайте расчёт во вкладке «Расчёты».' }));

    const search = (state.ui.searchByTab?.questions || '').toLowerCase();
    const questions = [...calc.dictionaries.questions]
        .sort((a, b) => {
            const sa = SECTION_IDS.indexOf(a.section);
            const sb = SECTION_IDS.indexOf(b.section);
            if (sa !== sb) return sa - sb;
            return a.order - b.order;
        });
    const filtered = search
        ? questions.filter(q =>
            (q.title || '').toLowerCase().includes(search) ||
            (q.id || '').toLowerCase().includes(search))
        : questions;

    // Список присутствующих секций (с непустым списком вопросов после фильтра) —
    // нужен для toggleQuestionsSection при первой инициализации из null.
    const presentSecs = SECTION_IDS.filter(sec => filtered.some(q => q.section === sec));

    return el('section', { class: 'tab-pane' },
        el('div', { class: 'tab-toolbar' },
            el('h2', { class: 'tab-title', text: 'Вопросы' }),
            el('div', { class: 'tab-toolbar-actions' },
                el('input', {
                    class: 'input search-input',
                    type: 'text',
                    placeholder: 'Поиск по заголовку или ID (Ctrl+Alt+F)',
                    value: state.ui.searchByTab?.questions || '',
                    title: 'Фильтрация списка вопросов. Поиск по заголовку и ID вопроса',
                    attrs: { 'data-role': 'search-input', 'data-focus-key': 'search:questions' },
                    onInput: e => ctx.setSearch('questions', e.target.value)
                }),
                el('button', {
                    class: 'btn btn-ghost btn-icon-text',
                    title: 'Сохранить весь список вопросов в файл',
                    onClick: (e) => ctx.exportQuestions(e)
                },
                    icon('download', { size: 16 }),
                    el('span', { text: 'Экспорт' })
                ),
                el('button', {
                    class: 'btn btn-ghost btn-icon-text',
                    title: 'Загрузить список вопросов из файла. Существующие вопросы с тем же ID будут обновлены.',
                    onClick: (e) => ctx.importQuestions(e)
                },
                    icon('folder-open', { size: 16 }),
                    el('span', { text: 'Импорт' })
                ),
                el('button', {
                    class: 'btn btn-primary btn-icon-text',
                    title: 'Добавить новый вопрос для опросника (Ctrl+Alt+Q)',
                    onClick: () => ctx.openQuestionEditor(null)
                },
                    icon('plus', { size: 16 }),
                    el('span', { text: 'Добавить вопрос' })
                )
            )
        ),

        ...presentSecs.map(sec => {
            const list = filtered.filter(q => q.section === sec);
            const collapsed = isSectionCollapsed(sec, state);
            const label = SECTION_LABELS[sec] || sec;
            return el('div', { class: ['q-section', !collapsed && 'q-section-expanded'] },
                el('button', {
                    class: 'q-section-title',
                    attrs: {
                        type: 'button',
                        'aria-expanded': collapsed ? 'false' : 'true',
                        'data-section': sec,
                        title: collapsed ? `Раскрыть раздел «${label}»` : `Свернуть раздел «${label}»`
                    },
                    onClick: () => ctx?.toggleQuestionsSection?.(sec, presentSecs)
                },
                    el('span', { class: 'q-section-chevron' }, icon(collapsed ? 'chevron-right' : 'chevron-down', { size: 14 })),
                    el('span', { class: 'q-section-label', text: label }),
                    el('span', { class: 'q-section-count', text: String(list.length) })
                ),
                !collapsed && el('table', { class: 'questions-table' },
                    el('thead', null, el('tr', null,
                        el('th', { text: 'Заголовок' }),
                        el('th', { text: 'ID (для формул: Q.id)' }),
                        el('th', { text: 'Тип' }),
                        el('th', { text: 'По умолч.' }),
                        el('th', { text: 'Порядок' }),
                        el('th', { text: 'Действия' })
                    )),
                    el('tbody', null,
                        ...list.map(q => el('tr', null,
                            el('td', { text: q.title }),
                            el('td', null, el('code', { class: 'q-id', text: q.id })),
                            el('td', { text: QUESTION_TYPE_LABELS[q.type] || q.type }),
                            el('td', { text: q.defaultValue !== undefined ? String(q.defaultValue) : '—' }),
                            el('td', { text: String(q.order) }),
                            el('td', { class: 'col-actions' },
                                el('button', { class: 'btn-icon', title: 'Изменить параметры этого вопроса', onClick: () => ctx.openQuestionEditor(q) }, icon('edit', { size: 16 })),
                                el('button', { class: 'btn-icon', title: 'Создать копию с похожими параметрами', onClick: () => ctx.duplicateQuestion(q.id) }, icon('copy', { size: 16 })),
                                el('button', {
                                    class: 'btn-icon btn-icon-danger',
                                    title: 'Удалить вопрос. Появится возможность отменить в течение нескольких секунд.',
                                    onClick: () => ctx.confirm({
                                        title: 'Удалить вопрос',
                                        message: `Удалить вопрос «${q.title}»? После удаления вы сможете нажать «Отменить» в уведомлении внизу экрана.`,
                                        confirmLabel: 'Удалить',
                                        onConfirm: () => ctx.deleteQuestion(q.id)
                                    })
                                }, icon('trash', { size: 16 }))
                            )
                        ))
                    )
                )
            );
        }),
        filtered.length === 0 && el('div', { class: 'empty-state empty-state-compact' },
            el('div', { class: 'empty-state-icon' }, icon('archive', { size: 48 })),
            el('div', { class: 'empty-state-title', text: search ? 'Ничего не найдено' : 'Список вопросов пуст' })
        )
    );
}
