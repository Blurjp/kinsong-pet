import * as Notifications from "expo-notifications";
import type { PetProfile } from "@sinian/core";
import { scheduleReminders } from "./reminders";

const scheduled = Notifications.scheduleNotificationAsync as jest.Mock;
const cancelled = Notifications.cancelAllScheduledNotificationsAsync as jest.Mock;

const pet: PetProfile = {
  name: "Max",
  species: "dog",
  coat: "#e0b67a",
  passed: "2025-10-20",
  born: "2012-03-14",
  favorites: { toys: [], treats: [], spots: [] },
  traits: [],
  wishes: [],
};

beforeEach(() => {
  scheduled.mockClear();
  cancelled.mockClear();
});

it("schedules a gentle note at 10 am on each remembrance day of the coming year, and nothing else", async () => {
  const n = await scheduleReminders(pet, true, "2026-10-19", new Date(2026, 9, 19, 12));
  expect(cancelled).toHaveBeenCalled();
  expect(n).toBe(scheduled.mock.calls.length);
  const dates = scheduled.mock.calls.map(([req]) => req.trigger.date as Date);
  expect(dates.every((d) => d.getHours() === 10)).toBe(true);
  const days = dates.map((d) => `${d.getMonth() + 1}-${d.getDate()}`);
  expect(days).toEqual(expect.arrayContaining(["10-20", "3-14", "4-11", "8-28", "9-12"])); // passing, birthday, National Pet Day, Rainbow Bridge Day, National Pet Memorial Day
  expect(new Set(days).size).toBe(days.length); // one note a day at most
  expect(scheduled.mock.calls[0]![0].content).toMatchObject({ title: "Max's garden", body: expect.stringMatching(/Would you like to stop by the garden\?$/) });
});

it("clears everything and schedules nothing while reminders are off", async () => {
  expect(await scheduleReminders(pet, false, "2026-10-19")).toBe(0);
  expect(cancelled).toHaveBeenCalled();
  expect(scheduled).not.toHaveBeenCalled();
});
