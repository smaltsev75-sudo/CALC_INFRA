export function nextCollapsedIds(current, id, presentIds = null) {
    if (current === null) {
        const all = Array.isArray(presentIds) ? presentIds : [];
        return all.filter(x => x !== id);
    }
    if (!Array.isArray(current)) return [];
    if (current.includes(id)) {
        return current.filter(x => x !== id);
    }
    return [...current, id];
}

export function nextGlobalExpandedIds(current, allIds) {
    const safeCurrent = Array.isArray(current) ? current : [];
    const safeAll = Array.isArray(allIds) ? allIds : [];
    const allExpanded = safeAll.every(id => safeCurrent.includes(id));
    return allExpanded ? [] : [...safeAll];
}
