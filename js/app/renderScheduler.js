export function createRenderScheduler(render) {
    let frameScheduled = false;
    return function scheduleRender() {
        if (frameScheduled) return;
        frameScheduled = true;
        requestAnimationFrame(() => {
            frameScheduled = false;
            render();
        });
    };
}
