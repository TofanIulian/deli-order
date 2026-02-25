import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

initializeApp();
const db = getFirestore();

const SLOT_LIMIT = 5;

function generateOrderCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export const placeOrder = onCall(async (req) => {
  const { pickupSlot, cart, total } = req.data || {};

  if (!pickupSlot?.label || typeof pickupSlot?.startMin !== "number") {
    throw new HttpsError("invalid-argument", "Invalid pickupSlot");
  }
  if (!Array.isArray(cart) || cart.length === 0) {
    throw new HttpsError("invalid-argument", "Cart is empty");
  }

  const now = new Date();
  const pickupDate = now.toISOString().slice(0, 10);

  const slotKey = `${pickupDate}_${pickupSlot.startMin}`;
  const slotRef = db.collection("slot_counts").doc(slotKey);

  const code = generateOrderCode();
  const orderRef = db.collection("orders").doc();

  await db.runTransaction(async (tx) => {
    const slotSnap = await tx.get(slotRef);
    const current = slotSnap.exists ? (slotSnap.data()?.count ?? 0) : 0;

    if (current >= SLOT_LIMIT) {
      throw new HttpsError("resource-exhausted", "Slot is full");
    }

    tx.set(
      slotRef,
      {
        pickupDate,
        pickupStartMin: pickupSlot.startMin,
        pickupTime: pickupSlot.label,
        count: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(orderRef, {
      code,
      pickupTime: pickupSlot.label,
      pickupStartMin: pickupSlot.startMin,
      pickupDate,
      items: cart,
      total: Number(total ?? 0),
      status: "Nou",
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(db.collection("orders_public").doc(orderRef.id), {
      pickupTime: pickupSlot.label,
      pickupStartMin: pickupSlot.startMin,
      pickupDate,
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(db.collection("order_public").doc(code), {
      code,
      status: "Nou",
      pickupTime: pickupSlot.label,
      pickupDate,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return { ok: true, code, orderId: orderRef.id };
});