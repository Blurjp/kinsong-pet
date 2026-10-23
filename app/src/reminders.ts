import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { gentleNudge, upcomingOccasions, type PetProfile } from "@sinian/core";

/**
 * Gentle reminders on remembrance days only, as local notifications: nothing
 * leaves the phone, and there is never a nudge on an ordinary day. The family
 * turns them on; until then nothing is scheduled.
 */

const isWeb = Platform.OS === "web";
/** iOS keeps at most 64 pending; a year of days fits well inside that. */
const MAX_PENDING = 60;
const HOUR = 10;

if (!isWeb) {
  // Shown as a banner even when the app is open.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

/** Ask for permission; true when reminders can be shown. */
export async function allowReminders(): Promise<boolean> {
  if (isWeb) return false;
  const now = await Notifications.getPermissionsAsync();
  if (now.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/**
 * Replace whatever was scheduled with the next year of remembrance days (or
 * nothing, when reminders are off). Run on every launch so the year rolls forward.
 * Returns how many reminders are waiting.
 */
export async function scheduleReminders(pet: PetProfile | undefined, on: boolean, today: string, now = new Date()): Promise<number> {
  if (isWeb) return 0;
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!pet || !on) return 0;
  const days = [...new Set(upcomingOccasions(pet, today, 365).map((o) => o.on))];
  let count = 0;
  for (const day of days) {
    const body = gentleNudge(pet, day);
    const [y, m, d] = day.split("-").map(Number);
    const date = new Date(y!, m! - 1, d!, HOUR);
    if (!body || date <= now) continue;
    await Notifications.scheduleNotificationAsync({
      content: { title: `${pet.name}'s garden`, body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
    });
    if (++count >= MAX_PENDING) break;
  }
  return count;
}
