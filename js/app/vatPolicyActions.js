export function chooseVatPolicyAction({
    userVatPolicy,
    store,
    providerCtl,
    handleUpdateProviderResult
}) {
    const state = store.getState();
    const m = state.modals.vatPolicyChoice;
    if (!m || !m.open) return;
    const { providerId, preloaded } = m;
    store.closeModal('vatPolicyChoice');
    return providerCtl.applyProviderPricesWithVatPolicy(providerId, preloaded, userVatPolicy)
        .then(handleUpdateProviderResult);
}

export function cancelVatPolicyChoiceAction({ store }) {
    store.closeModal('vatPolicyChoice');
}
