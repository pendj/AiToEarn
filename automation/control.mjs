import { modelPermission, publishingPermission } from './policy.mjs';

export function automationControl(state, queues, readAuthority) {
  return {
    async status() {
      const authority = await readAuthority();
      return { ...state.status(), modelBlock: modelPermission(authority, Date.now()), publishingBlock: publishingPermission(authority, Date.now()),
        dailyBudgetMicrousd: authority.model?.dailyBudgetMicrousd || 0, timezone: 'America/New_York', schedule: '13:00' };
    },
    async pause() { state.pause(); await queues.pause(); },
    async resume() {
      const reason = modelPermission(await readAuthority(), Date.now());
      if (reason) return reason;
      // Resuming generation never releases the native publication queues.
      await queues.pause();
      state.resume();
      return null;
    },
  };
}
