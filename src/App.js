import { useEffect, useState } from "react";
import { db } from "./firebase";

import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  deleteDoc
} from "firebase/firestore";

import {
  AppBar,
  Toolbar,
  Typography,
  Container,
  Button,
  Card,
  CardContent,
  TextField,
  Box,
  Tabs,
  Tab,
  Stack,
  Divider,
  FormControlLabel,
  Checkbox,
  Chip,
  Grid,
  Paper
} from "@mui/material";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import FiberNewIcon from "@mui/icons-material/FiberNew";

const PREP_BUFFER_MIN = 10;

const SLOT_MINUTES = 15; // din 15 in 15 minute
const WINDOW_HOURS = 4; // arata sloturi pe 4 ore in fata
const SLOT_LIMIT = 3; // limita comenzi pe slot

const STAFF_PIN = "1234";

// ---------- Time helpers ----------
function pad2(n) {
  return String(n).padStart(2, "0");
}

function minutesToHHMM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function roundUpToSlot(minutes, slotSize) {
  return Math.ceil(minutes / slotSize) * slotSize;
}

function makePickupSlots(now, bufferMin, slotSizeMin, windowHours, limitPerSlot) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = roundUpToSlot(nowMin + bufferMin, slotSizeMin);
  const endMin = startMin + windowHours * 60;

  const slots = [];
  for (let t = startMin; t < endMin; t += slotSizeMin) {
    const label = `${minutesToHHMM(t)} - ${minutesToHHMM(t + slotSizeMin)}`;
    slots.push({ label, limit: limitPerSlot, startMin: t });
  }
  return slots;
}

// ---------- Status chip helpers ----------
function chipColor(status) {
  if (status === "Gata") return "success";
  if (status === "In lucru") return "warning";
  if (status === "Nou") return "info";
  return "default";
}

function chipIcon(status) {
  if (status === "Gata") return <CheckCircleIcon fontSize="small" />;
  if (status === "In lucru") return <HourglassTopIcon fontSize="small" />;
  if (status === "Nou") return <FiberNewIcon fontSize="small" />;
  return null;
}

function App() {
  // -------- Client state --------
  const [cart, setCart] = useState([]);
  const [pickupSlot, setPickupSlot] = useState(null);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [orderCode, setOrderCode] = useState("");

  // -------- Firestore state --------
  const [orders, setOrders] = useState([]);
  const [productsDb, setProductsDb] = useState([]);


  // -------- Staff state --------
  const [showOnlyOpen, setShowOnlyOpen] = useState(true);
  const [staffTab, setStaffTab] = useState("orders"); // "orders" | "products"

  const [pinInput, setPinInput] = useState("");
  const [staffAllowed, setStaffAllowed] = useState(
    sessionStorage.getItem("staffAllowed") === "1"
  );

  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");


  // -------- Configurator (salads) --------
 
  // -------- Mode (client/staff) --------
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") || "client";
  const isStaff = mode === "staff";

  // -------- Pickup slots (dynamic) --------
  const pickupSlots = makePickupSlots(
    new Date(),
    PREP_BUFFER_MIN,
    SLOT_MINUTES,
    WINDOW_HOURS,
    SLOT_LIMIT
  );

  // -------- Firestore: live orders --------
  useEffect(() => {
    const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));

    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...d.data()
      }));
      setOrders(list);
    });

    return () => unsub();
  }, []);

  // -------- Firestore: live products --------
  useEffect(() => {
    const q = query(collection(db, "products"), orderBy("createdAt", "desc"));

    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...d.data()
      }));
      setProductsDb(list);
    });

    return () => unsub();
  }, []);

  // -------- Client helpers --------
  function addToCart(productOrItem) {
    setOrderPlaced(false);
    setOrderCode("");
    setCart((prev) => [...prev, productOrItem]);
  }

  function removeFromCart(indexToRemove) {
    setOrderPlaced(false);
    setOrderCode("");
    setCart((prev) => prev.filter((_, i) => i !== indexToRemove));
  }

  function generateOrderCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  function ordersCountForSlot(slotLabel) {
    // We store pickupTime in Firestore
    return orders.filter((o) => o.pickupTime === slotLabel).length;
  }

  function toMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  function isSlotInPast(slotLabel) {
    const start = slotLabel.split("-")[0].trim(); // "12:15"
    const slotStartMin = toMinutes(start);

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    return slotStartMin < nowMin + PREP_BUFFER_MIN;
  }

  const total = cart.reduce((sum, item) => sum + Number(item.price || 0), 0);
  const canPlaceOrder = cart.length > 0 && pickupSlot !== null;

  async function placeOrder() {
    const code = generateOrderCode();
    const now = new Date();
    const pickupDate = now.toISOString().slice(0, 10); // YYYY-MM-DD

    const newOrder = {
      code,
      pickupTime: pickupSlot.label,
      pickupStartMin: pickupSlot.startMin,
      pickupDate,
      items: cart,
      total,
      status: "Nou",
      createdAt: serverTimestamp()
    };

    await addDoc(collection(db, "orders"), newOrder);

    setOrderCode(code);
    setOrderPlaced(true);

    setCart([]);
    setPickupSlot(null);
  }

  async function setStatus(orderId, newStatus) {
    await updateDoc(doc(db, "orders", orderId), { status: newStatus });
  }

  // -------- Staff auth (PIN) --------
  function tryStaffLogin(e) {
    e.preventDefault();
    if (pinInput === STAFF_PIN) {
      setStaffAllowed(true);
      sessionStorage.setItem("staffAllowed", "1");
      setPinInput("");
    } else {
      alert("PIN gresit");
    }
  }

  function staffLogout() {
    setStaffAllowed(false);
    sessionStorage.removeItem("staffAllowed");
  }

  // -------- Products admin --------
  async function addProduct(e) {
    e.preventDefault();
    const name = newName.trim();
    const price = Number(newPrice);

    if (!name) return alert("Scrie numele produsului");
    if (!Number.isFinite(price) || price <= 0) return alert("Pret invalid");

    await addDoc(collection(db, "products"), {
      name,
      price,
      active: true,
      createdAt: serverTimestamp()
    });

    setNewName("");
    setNewPrice("");
  }

  async function toggleProductActive(product) {
    const nextActive = product.active === false ? true : false;
    await updateDoc(doc(db, "products", product.id), { active: nextActive });
  }

  async function updateProductPrice(product, priceStr) {
    const price = Number(priceStr);
    if (!Number.isFinite(price) || price <= 0) return alert("Pret invalid");
    await updateDoc(doc(db, "products", product.id), { price });
  }

  async function removeProduct(product) {
    if (!window.confirm(`Stergi produsul "${product.name}"?`)) return;
    await deleteDoc(doc(db, "products", product.id));
  }

  // -------- Sorting / filtering --------
  const sortedOrders = [...orders].sort((a, b) =>
    (a.pickupTime || "").localeCompare(b.pickupTime || "")
  );

  const staffOrders = showOnlyOpen
    ? sortedOrders.filter((o) => o.status !== "Gata")
    : sortedOrders;

  // -------- Configurator helpers --------
 



  

  function formatEUR(n) {
    return `€${Number(n).toFixed(2)}`;
  }

  return (
    <>
      <AppBar position="sticky" elevation={1}>
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Deli – Quick Order
          </Typography>

          <Button color="inherit" href="/">
            Client
          </Button>
          <Button color="inherit" href="/?mode=staff">
            Staff
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="md" sx={{ py: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 800, mb: 0.5 }}>
          Deli – Quick Order
        </Typography>
        <Typography variant="body1" sx={{ opacity: 0.8, mb: 2 }}>
          Order and pick up at your chosen time
        </Typography>

        <Divider sx={{ mb: 2 }} />

        {/* STAFF: PIN screen */}
        {isStaff && !staffAllowed && (
          <Card sx={{ borderRadius: 3 }}>
            <CardContent>
              <Typography variant="h5" sx={{ fontWeight: 800, mb: 1 }}>
                Staff Access
              </Typography>

              <Box
                component="form"
                onSubmit={tryStaffLogin}
                sx={{
                  display: "flex",
                  gap: 1,
                  flexWrap: "wrap",
                  alignItems: "center"
                }}
              >
                <TextField
                  type="password"
                  label="PIN"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  size="small"
                />

                <Button type="submit" variant="contained">
                  Sign in
                </Button>
              </Box>

              <Typography variant="body2" sx={{ mt: 1, opacity: 0.7 }}>
                Only staff can access this area.
              </Typography>
            </CardContent>
          </Card>
        )}

        {/* CLIENT UI */}
        {!isStaff && (
          <>
           <Grid container spacing={2}>
  {/* LEFT: Menu */}
  <Grid item xs={12} md={7}>
    <Typography variant="h5" sx={{ fontWeight: 900, mb: 1 }}>
      Menu
    </Typography>

    <Typography sx={{ opacity: 0.75, mb: 2 }}>
      Tap an item to add it. Some items can be customized.
    </Typography>

    <Grid container spacing={2}>
      {productsDb
        .filter((p) => p.active !== false)
        .map((product) => (
          <Grid item xs={12} sm={6} key={product.id}>
            <Card sx={{ borderRadius: 3 }} variant="outlined">
              <CardContent>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="flex-start"
                  spacing={2}
                >
                  <Box>
                    <Typography
                      variant="h6"
                      sx={{ fontWeight: 800, lineHeight: 1.2 }}
                    >
                      {product.name}
                    </Typography>

                    {product?.config && (
                      <Typography variant="body2" sx={{ opacity: 0.7, mt: 0.5 }}>
                        Customizable
                      </Typography>
                    )}
                  </Box>

                  <Typography sx={{ fontWeight: 900, whiteSpace: "nowrap" }}>
                    {formatEUR(product.price)}
                  </Typography>
                </Stack>

                <Button
                  fullWidth
                  variant="contained"
                  sx={{ mt: 2, borderRadius: 2, py: 1.1, fontWeight: 800 }}
                  onClick={() => addToCart(product)}
                >
                  Add
                </Button>
              </CardContent>
            </Card>
          </Grid>
        ))}
    </Grid>
  </Grid>

  {/* RIGHT: Cart */}
  <Grid item xs={12} md={5}>
    <Box sx={{ position: { md: "sticky" }, top: { md: 88 } }}>
      <Paper sx={{ p: 2, borderRadius: 3 }} variant="outlined">
        <Typography variant="h5" sx={{ fontWeight: 900, mb: 1 }}>
          Cart
        </Typography>

        {cart.length === 0 ? (
          <Typography sx={{ opacity: 0.75 }}>Your cart is empty.</Typography>
        ) : (
          <Stack spacing={1}>
            {cart.map((item, index) => (
              <Paper
                key={index}
                variant="outlined"
                sx={{ p: 1.25, borderRadius: 2 }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="flex-start"
                  justifyContent="space-between"
                >
                  <Box sx={{ pr: 1 }}>
                    <Typography sx={{ fontWeight: 800, lineHeight: 1.2 }}>
                      {item.displayName || item.name}
                    </Typography>
                    <Typography variant="body2" sx={{ opacity: 0.75, mt: 0.25 }}>
                      {formatEUR(item.price)}
                    </Typography>
                  </Box>

                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    sx={{ borderRadius: 2, minWidth: 0, px: 1.2 }}
                    onClick={() => removeFromCart(index)}
                  >
                    X
                  </Button>
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}

        <Divider sx={{ my: 2 }} />

        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography sx={{ fontWeight: 900, fontSize: 18 }}>Total</Typography>
          <Typography sx={{ fontWeight: 900, fontSize: 18 }}>
            {formatEUR(total)}
          </Typography>
        </Stack>

        <Divider sx={{ my: 2 }} />

        <Typography variant="h6" sx={{ fontWeight: 900, mb: 1 }}>
          Pickup time
        </Typography>

        <Stack spacing={0.8}>
          {pickupSlots.map((slot) => {
            const used = ordersCountForSlot(slot.label);
            const isFull = used >= slot.limit;
            const isPast = isSlotInPast(slot.label);
            const disabledSlot = isFull || isPast;

            return (
              <Paper
                key={slot.label}
                variant="outlined"
                sx={{
                  p: 1,
                  borderRadius: 2,
                  opacity: disabledSlot ? 0.5 : 1
                }}
              >
                <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input
                    type="radio"
                    name="pickup"
                    value={slot.label}
                    checked={pickupSlot?.label === slot.label}
                    disabled={disabledSlot}
                    onChange={() => {
                      setPickupSlot(slot);
                      setOrderPlaced(false);
                      setOrderCode("");
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 800 }}>{slot.label}</div>
                    <div style={{ opacity: 0.7, fontSize: 13 }}>
                      Capacity: {used}/{slot.limit}
                      {isFull ? " • FULL" : ""}
                      {isPast && !isFull ? " • CLOSED" : ""}
                    </div>
                  </div>
                </label>
              </Paper>
            );
          })}
        </Stack>

        <Button
          fullWidth
          variant="contained"
          sx={{ mt: 2, borderRadius: 2, py: 1.2, fontWeight: 900 }}
          disabled={!canPlaceOrder}
          onClick={placeOrder}
        >
          Pay & Place order
        </Button>

        {!canPlaceOrder && (
          <Typography sx={{ mt: 1, opacity: 0.75 }}>
            Add items and choose a pickup time.
          </Typography>
        )}

        {orderPlaced && (
          <Paper sx={{ p: 2, borderRadius: 3, mt: 2 }} variant="outlined">
            <Typography variant="h6" sx={{ fontWeight: 900 }}>
              Order confirmed
            </Typography>
            <Typography sx={{ mt: 1 }}>
              Code: <b style={{ letterSpacing: 2 }}>{orderCode}</b>
            </Typography>
          </Paper>
        )}
      </Paper>
    </Box>
  </Grid>
</Grid>

          </>
        )}

        {/* STAFF UI */}
        {isStaff && staffAllowed && (
          <>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ mb: 2, flexWrap: "wrap" }}
            >
              <Button variant="outlined" onClick={staffLogout}>
                Logout
              </Button>

              <Tabs value={staffTab} onChange={(_, v) => setStaffTab(v)} sx={{ minHeight: 0 }}>
                <Tab label="Orders" value="orders" />
                <Tab label="Products" value="products" />
              </Tabs>

              {staffTab === "orders" && (
                <FormControlLabel
                  sx={{ ml: "auto" }}
                  control={
                    <Checkbox
                      checked={showOnlyOpen}
                      onChange={(e) => setShowOnlyOpen(e.target.checked)}
                    />
                  }
                  label="Only open orders"
                />
              )}
            </Stack>

            <Divider sx={{ mb: 2 }} />

            {staffTab === "orders" && (
              <>
                <Typography variant="h5" sx={{ fontWeight: 800, mb: 1 }}>
                  Orders (live)
                </Typography>

                {staffOrders.length === 0 && (
                  <Typography sx={{ opacity: 0.7 }}>No orders yet.</Typography>
                )}

                {staffOrders.map((order) => (
                  <Card key={order.id} sx={{ mb: 2, borderRadius: 3 }}>
                    <CardContent>
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        justifyContent="space-between"
                        flexWrap="wrap"
                      >
                        <Typography variant="h6" sx={{ fontWeight: 800 }}>
                          {order.pickupTime}
                        </Typography>

                        <Chip
                          icon={chipIcon(order.status)}
                          label={order.status}
                          color={chipColor(order.status)}
                          variant="filled"
                          size="small"
                        />

                        <Typography sx={{ fontWeight: 800, letterSpacing: 1 }}>
                          {order.code}
                        </Typography>
                      </Stack>

                      <Typography sx={{ mt: 1 }}>
                        <b>Total:</b> {order.total}
                      </Typography>

                      <Typography sx={{ mt: 1, fontWeight: 800 }}>Items</Typography>
                      {(order.items || []).map((it, idx) => (
                        <Typography key={idx} variant="body2">
                          - {it.displayName || it.name} ({it.price})
                        </Typography>
                      ))}

                      <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap">
                        <Button variant="outlined" onClick={() => setStatus(order.id, "Nou")}>
                          Nou
                        </Button>
                        <Button
                          variant="outlined"
                          onClick={() => setStatus(order.id, "In lucru")}
                        >
                          In lucru
                        </Button>
                        <Button variant="contained" onClick={() => setStatus(order.id, "Gata")}>
                          Gata
                        </Button>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </>
            )}

            {staffTab === "products" && (
              <>
                <Typography variant="h5" sx={{ fontWeight: 800, mb: 1 }}>
                  Products
                </Typography>

                <Card sx={{ borderRadius: 3, mb: 2 }}>
                  <CardContent>
                    <Typography sx={{ fontWeight: 800, mb: 1 }}>Add product</Typography>
                    <Box
                      component="form"
                      onSubmit={addProduct}
                      sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}
                    >
                      <TextField
                        label="Name"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        size="small"
                      />
                      <TextField
                        label="Price"
                        value={newPrice}
                        onChange={(e) => setNewPrice(e.target.value)}
                        size="small"
                        sx={{ width: 140 }}
                      />
                      <Button type="submit" variant="contained">
                        Add
                      </Button>
                    </Box>

                    <Typography variant="body2" sx={{ mt: 1, opacity: 0.7 }}>
                      Tip: For salad-config products, edit the document in Firestore and add:
                      customizable=true, includedSalads, extraSaladPrice, salads[].
                    </Typography>
                  </CardContent>
                </Card>

                {productsDb.length === 0 && (
                  <Typography sx={{ opacity: 0.7 }}>No products yet.</Typography>
                )}

                {productsDb.map((p) => (
                  <Card key={p.id} sx={{ mb: 2, borderRadius: 3 }}>
                    <CardContent>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Typography sx={{ fontWeight: 800 }}>{p.name}</Typography>
                        <Chip
                          size="small"
                          label={p.active === false ? "Inactive" : "Active"}
                          variant={p.active === false ? "outlined" : "filled"}
                        />
                      </Stack>

                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }} flexWrap="wrap">
                        <Typography variant="body2">Price:</Typography>
                        <TextField
                          defaultValue={p.price}
                          size="small"
                          sx={{ width: 140 }}
                          onBlur={(e) => updateProductPrice(p, e.target.value)}
                        />
                        <Button
                          variant="outlined"
                          onClick={() => toggleProductActive(p)}
                        >
                          {p.active === false ? "Activate" : "Deactivate"}
                        </Button>
                        <Button
                          variant="outlined"
                          color="error"
                          onClick={() => removeProduct(p)}
                        >
                          Delete
                        </Button>
                      </Stack>

                      <Typography variant="body2" sx={{ mt: 1, opacity: 0.7 }}>
                        Price saves when you click outside the input.
                      </Typography>
                    </CardContent>
                  </Card>
                ))}
              </>
            )}
          </>
        )}
      </Container>
    </>
  );
}

export default App;
