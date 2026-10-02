import assert from "node:assert/strict";
import { load } from "./helpers/load-typescript.mjs";

const {
  validateAddress,
  validateContact,
  validateOwnerExtra,
  validateSellerExtra,
  validateRescuerExtra,
  validateProfileForm,
  isValid,
} = load("lib/profile-validation.ts");

const provincesData = { "تهران": ["تهران", "اسلامشهر"], "فارس": ["شیراز"] };

let passed = 0;
const check = (cond, label) => { assert.ok(cond, label); passed++; };

// address
check(Object.keys(validateAddress(null, provincesData)).length === 3, "empty address has 3 errors");
check(
  validateAddress({ province: "تهران", city: "شیراز", street: "ولیعصر" }, provincesData).city !== undefined,
  "city must belong to province"
);
check(
  isValid(validateAddress({ province: "تهران", city: "تهران", street: "ولیعصر" }, provincesData)),
  "valid address passes"
);
check(
  validateAddress({ province: "تهران", city: "تهران", street: "ولیعصر", postal_code: "123" }, provincesData)
    .postal_code !== undefined,
  "short postal code rejected"
);
check(
  isValid(validateAddress({ province: "تهران", city: "تهران", street: "ولیعصر", postal_code: "" }, provincesData)),
  "empty postal code is optional"
);

// contact
check(validateContact({}).phone1 !== undefined, "phone1 required");
check(validateContact({ phone1: "0912" }).phone1 !== undefined, "short phone1 rejected");
check(validateContact({ phone1: "09123456789" }).phone1 === undefined, "valid phone1 accepted");
check(validateContact({ phone1: "09123456789", phone2: "123" }).phone2 !== undefined, "invalid phone2 rejected");
check(validateContact({ phone1: "09123456789" }).phone2 === undefined, "empty phone2 is optional");

// owner extra
check(validateOwnerExtra({ mileage: "85000" }).mileage === undefined, "reasonable mileage accepted");
check(validateOwnerExtra({ mileage: "abc" }).mileage !== undefined, "non-numeric mileage rejected");
check(validateOwnerExtra({ mileage: "99999999" }).mileage !== undefined, "out-of-range mileage rejected");
check(validateOwnerExtra({ vin: "12345678901234567" }).vin === undefined, "17-char VIN accepted");
check(validateOwnerExtra({ vin: "short" }).vin !== undefined, "short VIN rejected");
check(validateOwnerExtra({}).vin === undefined, "empty VIN is optional");

// seller/service extra
check(validateSellerExtra({ experience: "15", warranty: "6" }).experience === undefined, "valid experience accepted");
check(validateSellerExtra({ experience: "200" }).experience !== undefined, "out-of-range experience rejected");
check(validateSellerExtra({ warranty: "500" }).warranty !== undefined, "out-of-range warranty rejected");

// rescuer extra
check(validateRescuerExtra({ radius: "30" }).radius === undefined, "valid radius accepted");
check(validateRescuerExtra({ radius: "0" }).radius !== undefined, "zero radius rejected");
check(validateRescuerExtra({ radius: "9999" }).radius !== undefined, "huge radius rejected");

// combined form, per role
const validOwnerState = {
  addressData: { province: "تهران", city: "تهران", street: "ولیعصر" },
  contact: { phone1: "09123456789" },
  carData: { mileage: "1000" },
};
check(isValid(validateProfileForm("owner", validOwnerState, provincesData)), "valid owner form passes");
check(
  !isValid(validateProfileForm("owner", { ...validOwnerState, carData: { mileage: "abc" } }, provincesData)),
  "invalid owner mileage fails whole-form validation"
);

const validRescuerState = {
  addressData: { province: "فارس", city: "شیراز", street: "زند" },
  contact: { phone1: "09123456789" },
  rescuerData: { radius: "20", experience: "5" },
};
check(isValid(validateProfileForm("rescuer", validRescuerState, provincesData)), "valid rescuer form passes");
check(
  !isValid(validateProfileForm("rescuer", { ...validRescuerState, rescuerData: { radius: "0" } }, provincesData)),
  "invalid rescuer radius fails whole-form validation"
);

console.log(`${passed} profile validation assertions passed.`);
