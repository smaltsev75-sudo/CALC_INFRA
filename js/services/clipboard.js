/**
 * Small clipboard helper for user-triggered copy actions.
 */

export async function copyTextToClipboard(value) {
    const text = String(value ?? '');
    if (typeof navigator === 'undefined'
        || !navigator.clipboard
        || typeof navigator.clipboard.writeText !== 'function') {
        return false;
    }
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (_err) {
        return false;
    }
}
