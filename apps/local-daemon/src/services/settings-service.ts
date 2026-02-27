import type { LocalSettings } from "./types.js";
import { LocalStore } from "./local-store.js";

export class SettingsService {
  constructor(private readonly store: LocalStore) {}

  getSettings(): LocalSettings {
    return this.store.getSettings();
  }

  updateSettings(patch: Partial<LocalSettings>): LocalSettings {
    return this.store.updateSettings(patch);
  }
}
