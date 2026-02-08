import { useEffect, useMemo, useState } from "react";
import { db } from "./firebase";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
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
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  ToggleButton,
  ToggleButtonGroup,
  CardActionArea,
  Snackbar,
  Alert
} from "@mui/material";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import FiberNewIcon from "@mui/icons-material/FiberNew";

// ===== SETTINGS =====
const PREP_BUFFER_MIN = 10;

const SLOT_MINUTES = 15;
const WINDOW_HOURS = 2;
const SLOT_LIMIT = 3;

// PIN-only
const STAFF_PIN = "1111";
const ADMIN_PIN = "9999";

// ===== TIME HELPERS =====
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

// ===== UI HELPERS =====
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

function formatEUR(n) {
  return `€${Number(n).toFixed(2)}`;
}

export default function App() {
  // ===== MODE =====
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") || "client";
  const isStaff = mode === "staff";

  // ===== ROLE (PIN-only) =====
  const [pinInput, setPinInput] = useState("");
  const [role, setRole] = useState(sessionStorage.getItem("role") || "");
  const staffAllowed = isStaff && (role === "staff" || role === "admin");
  const isAdminRole = role === "admin";

  function tryStaffLogin(e) {
    e.preventDefault();

    if (pinInput === ADMIN_PIN) {
      sessionStorage.setItem("role", "admin");
      setRole("admin");
      setPinInput("");
      return;
    }

    if (pinInput === STAFF_PIN) {
      sessionStorage.setItem("role", "staff");
      setRole("staff");
      setPinInput("");
      return;
    }

    alert("PIN greșit");
  }

  function staffLogout() {
    sessionStorage.removeItem("role");
    setRole("");
    setPinInput("");
  }

  // ===== CLIENT STATE =====
  const [cart, setCart] = useState([]);
  const [pickupSlot, setPickupSlot] = useState(null);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [orderCode, setOrderCode] = useState("");
  const [snack, setSnack] = useState({ open: false, msg: "" });

  // ===== FIRESTORE STATE =====
  const [orders, setOrders] = useState([]);
  const [productsDb, setProductsDb] = useState([]);

  // ===== STAFF UI STATE =====
  const [showOnlyOpen, setShowOnlyOpen] = useState(true);
  const [staffTab, setStaffTab] = useState("orders");
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");

  // ===== CONFIGURATOR STATE =====
  const [configOpen, setConfigOpen] = useState(false);
  const [configProduct, setConfigProduct] = useState(null);
  const [selectedSalads, setSelectedSalads] = useState([]);
  const [customSelections, setCustomSelections] = useState({});

  function openConfigurator(product) {
    setConfigProduct(product);
    setSelectedSalads([]);
    setCustomSelections({});
    setConfigOpen(true);
  }

  function toggleSalad(name) {
    setSelectedSalads((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]
    );
  }

  // ===== PICKUP SLOTS =====
  const pickupSlots = useMemo(
    () =>
      makePickupSlots(new Date(), PREP_BUFFER_MIN, SLOT_MINUTES, WINDOW_HOURS, SLOT_LIMIT),
    []
  );

  function ordersCountForSlot(slotLabel) {
    return orders.filter((o) => o.pickupTime === slotLabel).length;
  }

  function toMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  function isSlotInPast(slotLabel) {
    const start = slotLabel.split("-")[0].trim();
    const slotStartMin = toMinutes(start);

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return slotStartMin < nowMin + PREP_BUFFER_MIN;
  }

  // ===== LIVE ORDERS =====
  useEffect(() => {
    const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setOrders(list);
    });
    return () => unsub();
  }, []);

  // ===== LIVE PRODUCTS =====
  useEffect(() => {
    const q = query(collection(db, "products"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setProductsDb(list);
    });
    return () => unsub();
  }, []);

  // ===== CART HELPERS =====
  function addToCart(item) {
    setOrderPlaced(false);
    setOrderCode("");
    setCart((prev) => [...prev, item]);
    setSnack({ open: true, msg: "Added to cart" });
  }

  function removeFromCart(indexToRemove) {
    setOrderPlaced(false);
    setOrderCode("");
    setCart((prev) => prev.filter((_, i) => i !== indexToRemove));
  }

  function generateOrderCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  const total = cart.reduce((sum, item) => sum + Number(item.price || 0), 0);
  const canPlaceOrder = cart.length > 0 && pickupSlot !== null;

  async function placeOrder() {
    const code = generateOrderCode();
    const now = new Date();
    const pickupDate = now.toISOString().slice(0, 10);

    const newOrder = {
      code,
      pickupTime: pickupSlot.label,
      pickupStartMin: pickupSlot.startMin,
      pickupDate,
      items: cart,
      total: Number(total.toFixed(2)),
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

  // ===== PRODUCTS ADMIN =====
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

  // ===== STAFF ORDERS SORT/FILTER =====
  const sortedOrders = useMemo(
    () => [...orders].sort((a, b) => (a.pickupTime || "").localeCompare(b.pickupTime || "")),
    [orders]
  );

  const staffOrders = useMemo(
    () => (showOnlyOpen ? sortedOrders.filter((o) => o.status !== "Gata") : sortedOrders),
    [showOnlyOpen, sortedOrders]
  );

  // ===== CONFIG CALCS (ONE PLACE) =====
  const saladsEnabled = !!configProduct?.config?.salads?.enabled;
  const saladsIncluded = Number(configProduct?.config?.salads?.included || 0);
  const extraPrice = Number(configProduct?.config?.salads?.extraPrice || 0);
  const extraCount = saladsEnabled ? Math.max(0, selectedSalads.length - saladsIncluded) : 0;

  const cfgOpts = configProduct?.config?.options || [];
  const missingRequired = cfgOpts.some((o) => {
    if (!o.required) return false;
    const v = customSelections[o.key];
    return o.type === "multi" ? !(Array.isArray(v) && v.length > 0) : !v;
  });

  const saladsOk = !saladsEnabled || selectedSalads.length >= saladsIncluded;
  const disableAddToCart = !configProduct || missingRequired || !saladsOk;

  const configTotalPrice = useMemo(() => {
    if (!configProduct) return 0;
    return Number(configProduct.price) + extraCount * extraPrice;
  }, [configProduct, extraCount, extraPrice]);

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

      <Container maxWidth="lg" sx={{ py: 3 }}>
        {/* STAFF PIN ONLY */}
        {isStaff && !staffAllowed && (
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2, maxWidth: 420 }}>
            <Typography variant="h6" sx={{ fontWeight: 900, mb: 1 }}>
              Staff / Admin Access
            </Typography>

            <Box component="form" onSubmit={tryStaffLogin} sx={{ display: "grid", gap: 1.5 }}>
              <TextField
                label="PIN"
                type="password"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
              />
              <Button type="submit" variant="contained" sx={{ fontWeight: 900 }}>
                Enter
              </Button>
            </Box>
            <Typography variant="body2" sx={{ mt: 1, opacity: 0.7 }}>
              Staff PIN = {STAFF_PIN} • Admin PIN = {ADMIN_PIN}
            </Typography>
          </Paper>
        )}

        {/* CLIENT UI */}
        {!isStaff && (
          <Grid container spacing={2.5} alignItems="flex-start">
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
                      <Card variant="outlined" sx={{ borderRadius: 3, height: "100%" }}>
                        <CardActionArea
                          onClick={() => {
                            const isConfigurable =
                              !!product?.config &&
                              (product.config?.salads?.enabled ||
                                (product.config?.options?.length ?? 0) > 0);

                            if (isConfigurable) openConfigurator(product);
                            else addToCart(product);
                          }}
                          sx={{ borderRadius: 3 }}
                        >
                          <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
                            <Box>
                              <Typography variant="h6" sx={{ fontWeight: 900, lineHeight: 1.15 }}>
                                {product.name}
                              </Typography>

                              {product?.config && (
                                <Typography variant="body2" sx={{ opacity: 0.75, mt: 0.5 }}>
                                  Tap to customize
                                </Typography>
                              )}
                            </Box>

                            <Box sx={{ mt: "auto" }}>
                              <Stack
                                direction="row"
                                justifyContent="space-between"
                                alignItems="center"
                                sx={{ mb: 1 }}
                              >
                                <Typography sx={{ opacity: 0.75 }}>Price</Typography>
                                <Typography sx={{ fontWeight: 900 }}>
                                  {formatEUR(product.price)}
                                </Typography>
                              </Stack>

                              <Button
                                fullWidth
                                variant="contained"
                                sx={{ borderRadius: 2, py: 1.1, fontWeight: 900 }}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();

                                  const isConfigurable =
                                    !!product?.config &&
                                    (product.config?.salads?.enabled ||
                                      (product.config?.options?.length ?? 0) > 0);

                                  if (isConfigurable) openConfigurator(product);
                                  else addToCart(product);
                                }}
                              >
                                {product?.config ? "Customize" : "Add"}
                              </Button>
                            </Box>
                          </CardContent>
                        </CardActionArea>
                      </Card>
                    </Grid>
                  ))}
              </Grid>
            </Grid>

            {/* RIGHT: Cart */}
            <Grid item xs={12} md={5}>
              <Box sx={{ position: { md: "sticky" }, top: { md: 88 } }}>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
                  <Typography variant="h5" sx={{ fontWeight: 900, mb: 1 }}>
                    Cart
                  </Typography>

                  {cart.length === 0 ? (
                    <Typography sx={{ opacity: 0.75 }}>Your cart is empty.</Typography>
                  ) : (
                    <Stack spacing={1}>
                      {cart.map((item, index) => (
                        <Paper key={index} variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="flex-start"
                            justifyContent="space-between"
                          >
                            <Box sx={{ pr: 1 }}>
                              <Typography sx={{ fontWeight: 900, lineHeight: 1.2 }}>
                                {item.displayName || item.name}
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

                  <Stack spacing={1}>
                    {pickupSlots.map((slot) => {
                      const used = ordersCountForSlot(slot.label);
                      const isFull = used >= slot.limit;
                      const isPast = isSlotInPast(slot.label);
                      const disabledSlot = isFull || isPast;
                      const selected = pickupSlot?.label === slot.label;

                      return (
                        <Paper
                          key={slot.label}
                          variant="outlined"
                          sx={{
                            p: 1.25,
                            borderRadius: 2,
                            opacity: disabledSlot ? 0.5 : 1,
                            borderWidth: selected ? 2 : 1
                          }}
                        >
                          <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            <input
                              type="radio"
                              name="pickup"
                              value={slot.label}
                              checked={selected}
                              disabled={disabledSlot}
                              onChange={() => {
                                setPickupSlot(slot);
                                setOrderPlaced(false);
                                setOrderCode("");
                              }}
                            />
                            <div>
                              <div style={{ fontWeight: 900 }}>{slot.label}</div>
                              <div style={{ opacity: 0.75, fontSize: 13 }}>
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
        )}

        {/* STAFF UI */}
        {isStaff && staffAllowed && (
          <>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2, flexWrap: "wrap" }}>
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
                        <b>Total:</b> {formatEUR(order.total)}
                      </Typography>

                      <Typography sx={{ mt: 1, fontWeight: 800 }}>Items</Typography>
                      {(order.items || []).map((it, idx) => (
                        <Typography key={idx} variant="body2">
                          - {it.displayName || it.name} ({formatEUR(it.price)})
                        </Typography>
                      ))}

                      <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap">
                        <Button variant="outlined" onClick={() => setStatus(order.id, "Nou")}>
                          Nou
                        </Button>
                        <Button variant="outlined" onClick={() => setStatus(order.id, "In lucru")}>
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
                  Products {isAdminRole ? "(Admin)" : "(Staff)"}
                </Typography>

                {isAdminRole && (
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
                    </CardContent>
                  </Card>
                )}

                {productsDb.length === 0 && <Typography sx={{ opacity: 0.7 }}>No products yet.</Typography>}

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
                          disabled={!isAdminRole}
                        />

                        <Button variant="outlined" onClick={() => toggleProductActive(p)} disabled={!isAdminRole}>
                          {p.active === false ? "Activate" : "Deactivate"}
                        </Button>

                        <Button
                          variant="outlined"
                          color="error"
                          onClick={() => removeProduct(p)}
                          disabled={!isAdminRole}
                        >
                          Delete
                        </Button>
                      </Stack>

                      {!isAdminRole && (
                        <Typography variant="body2" sx={{ mt: 1, opacity: 0.7 }}>
                          Only Admin can edit products.
                        </Typography>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </>
            )}
          </>
        )}
      </Container>

      {/* SNACKBAR */}
      <Snackbar
        open={snack.open}
        autoHideDuration={1400}
        onClose={() => setSnack({ open: false, msg: "" })}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="success" variant="filled" onClose={() => setSnack({ open: false, msg: "" })}>
          {snack.msg}
        </Alert>
      </Snackbar>

      {/* CONFIG DIALOG */}
      <Dialog open={configOpen} onClose={() => setConfigOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 900 }}>Customize: {configProduct?.name || ""}</DialogTitle>

        <DialogContent dividers>
          {configProduct ? (
            <Stack spacing={2}>
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography sx={{ opacity: 0.75 }}>Base price</Typography>
                  <Typography sx={{ fontWeight: 900 }}>{formatEUR(configProduct.price)}</Typography>
                </Stack>
              </Paper>

              {/* OPTIONS */}
              {Array.isArray(configProduct?.config?.options) &&
                configProduct.config.options.map((opt) => {
                  const value = customSelections[opt.key] ?? (opt.type === "multi" ? [] : "");
                  const required = !!opt.required;

                  return (
                    <Paper key={opt.key} variant="outlined" sx={{ p: 1.5, borderRadius: 3 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                        <Typography sx={{ fontWeight: 900 }}>
                          {opt.label} {required ? "*" : ""}
                        </Typography>
                        {required && (
                          <Typography variant="body2" sx={{ opacity: 0.7 }}>
                            Required
                          </Typography>
                        )}
                      </Stack>

                      {opt.type === "single" ? (
                        <ToggleButtonGroup
                          value={value}
                          exclusive
                          onChange={(_, v) => {
                            if (!v) return;
                            setCustomSelections((prev) => ({ ...prev, [opt.key]: v }));
                          }}
                          sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}
                        >
                          {(opt.items || []).map((it) => (
                            <ToggleButton
                              key={it}
                              value={it}
                              sx={{ borderRadius: 999, textTransform: "none", fontWeight: 800, px: 2, py: 0.6 }}
                            >
                              {it}
                            </ToggleButton>
                          ))}
                        </ToggleButtonGroup>
                      ) : (
                        <ToggleButtonGroup
                          value={value}
                          onChange={(_, v) => setCustomSelections((prev) => ({ ...prev, [opt.key]: v }))}
                          sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}
                        >
                          {(opt.items || []).map((it) => (
                            <ToggleButton
                              key={it}
                              value={it}
                              sx={{ borderRadius: 999, textTransform: "none", fontWeight: 800, px: 2, py: 0.6 }}
                            >
                              {it}
                            </ToggleButton>
                          ))}
                        </ToggleButtonGroup>
                      )}
                    </Paper>
                  );
                })}

              {/* SALADS */}
              {configProduct?.config?.salads?.enabled && (
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                    <Typography sx={{ fontWeight: 900 }}>Salads</Typography>
                    <Typography variant="body2" sx={{ opacity: 0.75 }}>
                      {saladsIncluded} included · +{formatEUR(extraPrice)} each extra
                    </Typography>
                  </Stack>

                  <Grid container spacing={1} sx={{ mt: 1 }}>
                    {(configProduct.config.salads.items || []).map((s) => {
                      const checked = selectedSalads.includes(s);
                      return (
                        <Grid item xs={6} sm={4} key={s}>
                          <Button
                            fullWidth
                            variant={checked ? "contained" : "outlined"}
                            onClick={() => toggleSalad(s)}
                            sx={{
                              borderRadius: 2,
                              justifyContent: "flex-start",
                              fontWeight: checked ? 900 : 700,
                              textTransform: "none",
                              py: 1
                            }}
                          >
                            {s}
                          </Button>
                        </Grid>
                      );
                    })}
                  </Grid>

                  {extraCount > 0 && (
                    <Typography variant="caption" color="error" sx={{ display: "block", mt: 1 }}>
                      Extra salads will be charged (+{formatEUR(extraCount * extraPrice)}).
                    </Typography>
                  )}
                </Paper>
              )}

              {/* SUMMARY */}
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography sx={{ fontWeight: 900 }}>Total</Typography>
                  <Typography sx={{ fontWeight: 900 }}>{formatEUR(configTotalPrice)}</Typography>
                </Stack>

                {saladsEnabled && (
                  <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.75 }}>
                    {saladsIncluded} salads included · +{formatEUR(extraPrice)} each extra
                  </Typography>
                )}

                {!saladsOk && (
                  <Typography color="error" sx={{ mt: 1 }}>
                    Please select at least {saladsIncluded} salads.
                  </Typography>
                )}

                {missingRequired && (
                  <Typography color="error" sx={{ mt: 1 }}>
                    Please complete required options (*).
                  </Typography>
                )}
              </Paper>
            </Stack>
          ) : (
            <Typography sx={{ opacity: 0.75 }}>Loading…</Typography>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 2 }}>
          <Button variant="outlined" onClick={() => setConfigOpen(false)}>
            Cancel
          </Button>

          <Button
            variant="contained"
            disabled={disableAddToCart}
            onClick={() => {
              if (!configProduct) return;

              const opts = configProduct?.config?.options || [];
              const optText = opts
                .map((o) => {
                  const v = customSelections[o.key];
                  if (!v) return null;
                  return Array.isArray(v) ? `${o.label}: ${v.join(", ")}` : `${o.label}: ${v}`;
                })
                .filter(Boolean)
                .join(" • ");

              const saladsText =
                saladsEnabled && selectedSalads.length ? `Salads: ${selectedSalads.join(", ")}` : "";

              const parts = [optText, saladsText].filter(Boolean).join(" • ");
              const displayName = parts ? `${configProduct.name} (${parts})` : configProduct.name;

              addToCart({
                ...configProduct,
                price: Number(configTotalPrice.toFixed(2)),
                displayName,
                custom: { selections: customSelections, salads: selectedSalads }
              });

              setConfigOpen(false);
            }}
            sx={{ fontWeight: 900 }}
          >
            Add to cart
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
