import assert from "node:assert/strict";
import { load } from "./helpers/load-typescript.mjs";

const { getProfileCompleteness } = load("lib/profile-completeness.ts");

let passed = 0;
const check = (cond, label) => { assert.ok(cond, label); passed++; };

const emptyOwner = { address_data: {}, phone1: null, data: { car: {} } };
const r1 = getProfileCompleteness(emptyOwner, "owner");
check(r1.percent < 100, "empty owner profile is incomplete");
check(
  r1.missingRequired.some((m) => m.key === "phone1") &&
    r1.missingRequired.some((m) => m.key === "car.brandId"),
  "empty owner profile lists required core + role fields as missing"
);

const completeOwnerCore = {
  address_data: { province: "تهران", city: "تهران", street: "ولیعصر" },
  phone1: "09123456789",
  data: { car: { brandId: "iran-khodro", modelId: "samand" } },
};
const r2 = getProfileCompleteness(completeOwnerCore, "owner");
check(r2.missingRequired.length === 0, "owner with required fields has no missing required items");
check(r2.percent < 100, "owner with only required fields is not yet 100% (optional fields remain)");

const fullOwner = {
  address_data: { province: "تهران", city: "تهران", street: "ولیعصر" },
  phone1: "09123456789",
  data: {
    car: { brandId: "iran-khodro", modelId: "samand", year: "1402", displayName: "ماشین من", photoUrl: "x", mileage: "1000" },
  },
};
const r3 = getProfileCompleteness(fullOwner, "owner");
check(r3.percent === 100, "owner with every tracked field is 100% complete");

const emptySeller = { address_data: {}, phone1: null, data: { seller: {} } };
const r4 = getProfileCompleteness(emptySeller, "seller");
check(
  r4.missingRequired.some((m) => m.key === "seller.shopName") &&
    r4.missingRequired.some((m) => m.key === "seller.specialties"),
  "empty seller profile lists shopName and specialties as missing"
);

const minimalService = {
  address_data: { province: "تهران", city: "تهران", street: "ولیعصر" },
  phone1: "09123456789",
  data: { serviceExpertise: ["engine-transmission:تعمیرات موتور"] },
};
const r5 = getProfileCompleteness(minimalService, "service");
check(r5.missingRequired.length === 0, "service provider with expertise set has no missing required items");

const emptyRescuer = { address_data: {}, phone1: null, data: { rescuer: {} } };
const r6 = getProfileCompleteness(emptyRescuer, "rescuer");
check(
  r6.missingRequired.some((m) => m.key === "rescuer.rescueTypes"),
  "empty rescuer profile lists rescueTypes as missing"
);

console.log(`${passed} profile completeness assertions passed.`);
