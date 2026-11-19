import assert from "node:assert/strict";
import test from "node:test";
import {
  RECRUITMENT_LAYOUT_KEY,
  readRecruitmentLayout,
  writeRecruitmentLayout,
} from "../src/lib/recruitment-layout";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test("new visitors and server rendering start with the same photo layout", () => {
  assert.equal(readRecruitmentLayout(memoryStorage()), "card");
  assert.equal(readRecruitmentLayout(null), "card");
  assert.equal(readRecruitmentLayout(), "card");
  assert.doesNotThrow(() => writeRecruitmentLayout("card", null));
});

test("card and list choices survive a later read without touching other preferences", () => {
  const storage = memoryStorage();
  storage.setItem("unrelated-setting", "keep");
  writeRecruitmentLayout("card", storage);
  assert.equal(storage.values.get(RECRUITMENT_LAYOUT_KEY), "card");
  assert.equal(readRecruitmentLayout(storage), "card");
  writeRecruitmentLayout("list", storage);
  assert.equal(readRecruitmentLayout(storage), "list");
  assert.equal(storage.values.get("unrelated-setting"), "keep");
});

test("unknown or obsolete stored values fall back to the photo layout", () => {
  const storage = memoryStorage();
  for (const value of ["", "grid", "CARD", "null", '{"layout":"card"}']) {
    storage.setItem(RECRUITMENT_LAYOUT_KEY, value);
    assert.equal(readRecruitmentLayout(storage), "card");
  }
});

test("blocked reads and full storage never interrupt layout selection", () => {
  const storage = {
    getItem() {
      throw new Error("Storage access blocked");
    },
    setItem() {
      throw new Error("Storage quota exceeded");
    },
  };
  assert.equal(readRecruitmentLayout(storage), "card");
  assert.doesNotThrow(() => writeRecruitmentLayout("card", storage));
});

test("browser storage access itself can be blocked before getItem is called", () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      get localStorage() {
        throw new Error("SecurityError");
      },
    },
  });
  try {
    assert.equal(readRecruitmentLayout(), "card");
    assert.doesNotThrow(() => writeRecruitmentLayout("card"));
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
