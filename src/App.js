import { useEffect, useMemo, useState } from "react";
import { db,auth } from "./firebase";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  setDoc
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
  MenuItem,
  Snackbar,
  Alert,
  Fade
} from "@mui/material";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import FiberNewIcon from "@mui/icons-material/FiberNew";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";

// ===== SETTINGS =====
const PREP_BUFFER_MIN = 10;

const SLOT_MINUTES = 15;
const WINDOW_HOURS = 2;
const SLOT_LIMIT = 5;

// AUTH
const ADMIN_EMAILS = ["admin@deli.local"];



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

function playBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = "sine";
    o.frequency.value = 880; // beep
    o.connect(g);
    g.connect(ctx.destination);

    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);

    o.start();
    o.stop(ctx.currentTime + 0.26);

    setTimeout(() => ctx.close(), 400);
  } catch {
    // ignore (some browsers block until user interaction)
  }
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
const [lastPublicStatus, setLastPublicStatus] = useState("");
const [cartOpen, setCartOpen] = useState(false);
const [publicOrder, setPublicOrder] = useState(null);

  // ===== AUTH (Email/Password) =====
const [authUser, setAuthUser] = useState(null);
const [email, setEmail] = useState("");
const [password, setPassword] = useState("");

// staff = orice user autentificat (pe /?mode=staff)
const staffAllowed = isStaff && !!authUser;

// admin = doar emailurile din listă
const isAdminRole = !!authUser?.email && ADMIN_EMAILS.includes(authUser.email);
 




// categorie per produs (dacă nu există în DB, cade pe Rolls)
function getCategory(p) {
  const c = String(p?.category || "").trim().toLowerCase();

  // acceptă și “Rolls”, și “rolls”, și “Drinks”, etc.
  if (c === "rolls" || c === "sides" || c === "drinks") return c;

  // fallback dacă nu există category în DB
  return "rolls";
}

useEffect(() => {
  const unsub = onAuthStateChanged(auth, (u) => setAuthUser(u));
  return () => unsub();
}, []);

  async function tryStaffLogin(e) {
  e.preventDefault();
  try {
    await signInWithEmailAndPassword(auth, email.trim(), password);
    setPassword("");
  } catch (err) {
    alert(err.message);
  }
}

async function staffLogout() {
  await signOut(auth);
  setEmail("");
  setPassword("");
}

  // ===== CLIENT STATE =====
  const [cart, setCart] = useState([]);
  const [pickupSlot, setPickupSlot] = useState(null);
  const [activeCategory, setActiveCategory] = useState("rolls"); // default deschis: Rolls
  const [orderCode, setOrderCode] = useState("");
  const [snack, setSnack] = useState({ open: false, msg: "" });
const CATEGORIES = [
  { key: "rolls", label: "ROLLS" },
  { key: "sides", label: "SIDES" },
  { key: "drinks", label: "DRINKS" }
];
useEffect(() => {
  window.scrollTo({ top: 0, behavior: "smooth" });
}, [activeCategory]);
  // ===== FIRESTORE STATE =====
  const [orders, setOrders] = useState([]);
  const [productsDb, setProductsDb] = useState([]);
const [publicOrders, setPublicOrders] = useState([]);
  // ===== STAFF UI STATE =====
  const [showOnlyOpen, setShowOnlyOpen] = useState(true);
  const [staffTab, setStaffTab] = useState("orders");
  useEffect(() => {
  if (!isAdminRole && staffTab === "products") {
    setStaffTab("orders");
  }
}, [isAdminRole, staffTab]);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newCategory, setNewCategory] = useState("rolls");
  // ===== CONFIGURATOR STATE =====
  const [configOpen, setConfigOpen] = useState(false);
  const [configProduct, setConfigProduct] = useState(null);
  const [selectedSalads, setSelectedSalads] = useState([]);
  const [customSelections, setCustomSelections] = useState({});
  const [editOpen, setEditOpen] = useState(false);
  const [editProduct, setEditProduct] = useState(null);

  // draft fields (simple, safe)
  const [cfgSaladsEnabled, setCfgSaladsEnabled] = useState(false);
  const [cfgSaladsIncluded, setCfgSaladsIncluded] = useState("2");
  const [cfgSaladsExtraPrice, setCfgSaladsExtraPrice] = useState("0.7");
  const [cfgSaladsItemsText, setCfgSaladsItemsText] = useState("");

  // options (super simplu): scrii una pe linie: key|label|type|required|item1,item2,item3
  const [cfgOptionsText, setCfgOptionsText] = useState("");

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
  return publicOrders.filter((o) => o.pickupTime === slotLabel).length;
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
  if (!isStaff || !staffAllowed) {
    setOrders([]);
    return;
  }

  console.log("[ORDERS] subscribing");

  const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));

  const unsub = onSnapshot(
    q,
    (snap) => {
      console.log("[ORDERS] snap size =", snap.size);
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      console.log("[ORDERS] first =", list[0]);
      setOrders(list);
    },
    (err) => {
      console.error("[ORDERS] ERROR =", err);
    }
  );

  return () => {
    console.log("[ORDERS] unsub");
    unsub();
  };
}, [isStaff, staffAllowed]);

  // ===== LIVE PRODUCTS =====
  useEffect(() => {
  if (isStaff) return;

  const q = query(collection(db, "orders_public"), orderBy("createdAt", "desc"));

  const unsub = onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setPublicOrders(list);
    },
    (err) => console.error("PUBLIC ORDERS ERROR:", err)
  );

  return () => unsub();
}, [isStaff]);
  
  
  
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
    
    setOrderCode("");
    setCart((prev) => [...prev, item]);
    setSnack({ open: true, msg: "Added to cart" });
  }

  function removeFromCart(indexToRemove) {
    
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
const existing = orders.filter(o => o.pickupTime === pickupSlot.label);

if (existing.length >= SLOT_LIMIT) {
  alert("Slot full, choose another time");
  return;
}
   const orderRef = await addDoc(collection(db, "orders"), newOrder);

// 🔹 public capacity tracking
await setDoc(doc(db, "orders_public", orderRef.id), {
  pickupTime: pickupSlot.label,
  pickupStartMin: pickupSlot.startMin,
  pickupDate,
  createdAt: serverTimestamp()
});

// 🔹 client tracking (ce aveai deja)
await setDoc(doc(db, "order_public", code), {
  code,
  status: "Nou",
  pickupTime: pickupSlot.label,
  pickupDate,
  updatedAt: serverTimestamp()
});
    setOrderCode(code);
    
    setCart([]);
    setPickupSlot(null);
  }

  async function setStatus(orderId, orderCode, newStatus) {
  await updateDoc(doc(db, "orders", orderId), { status: newStatus });

  await updateDoc(doc(db, "order_public", orderCode), {
    status: newStatus,
    updatedAt: serverTimestamp()
  });
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
  category: newCategory,   // ✅ IMPORTANT
  active: true,
  createdAt: serverTimestamp()
});

    setNewName("");
    setNewPrice("");
    setNewCategory("rolls");
  }

async function updateProductCategory(product, category) {
  await updateDoc(doc(db, "products", product.id), { category });
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
function openEditConfig(p) {
  setEditProduct(p);

  const salads = p?.config?.salads || {};
  setCfgSaladsEnabled(!!salads.enabled);
  setCfgSaladsIncluded(String(salads.included ?? 2));
  setCfgSaladsExtraPrice(String(salads.extraPrice ?? 0.7));
  setCfgSaladsItemsText((salads.items || []).join("\n"));

  const opts = Array.isArray(p?.config?.options) ? p.config.options : [];
  // format text: key|label|single|true|Butter,Hot
  const lines = opts.map((o) => {
    const items = Array.isArray(o.items) ? o.items.join(",") : "";
    return `${o.key}|${o.label}|${o.type || "single"}|${o.required ? "true" : "false"}|${items}`;
  });
  setCfgOptionsText(lines.join("\n"));

  setEditOpen(true);
}

function parseOptionsText(text) {
  // fiecare linie: key|label|type|required|item1,item2,item3
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [key, label, type, required, itemsStr] = line.split("|").map((x) => (x || "").trim());
      const items = (itemsStr || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

      return {
        key,
        label: label || key,
        type: type === "multi" ? "multi" : "single",
        required: required === "true",
        items
      };
    })
    .filter((o) => o.key); // doar cele valide
}

async function saveEditConfig() {
  if (!editProduct) return;

  const saladsItems = cfgSaladsItemsText
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  const included = Number(cfgSaladsIncluded);
  const extraPrice = Number(cfgSaladsExtraPrice);

  const config = {
    salads: {
      enabled: !!cfgSaladsEnabled,
      included: Number.isFinite(included) ? included : 0,
      extraPrice: Number.isFinite(extraPrice) ? extraPrice : 0,
      items: saladsItems
    },
    options: parseOptionsText(cfgOptionsText)
  };

  await updateDoc(doc(db, "products", editProduct.id), { config });

  setEditOpen(false);
  setEditProduct(null);
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

useEffect(() => {
  if (!orderCode) return;

  const unsub = onSnapshot(doc(db, "order_public", orderCode), (snap) => {
    const next = snap.exists() ? snap.data() : null;

    if (next?.status && next.status !== lastPublicStatus) {
      setSnack({ open: true, msg: `Status: ${next.status}` });

      if (next.status === "Gata") {
        playBeep();
      }

      setLastPublicStatus(next.status);
    }

    setPublicOrder(next);
  });

  return () => unsub();
}, [orderCode, lastPublicStatus]);




 return (
  <>
    <AppBar position="sticky" elevation={1}>
      <Toolbar>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          Deli – Quick Order
        </Typography>

        {isStaff && staffAllowed && (
          <Button color="inherit" onClick={staffLogout}>
            Logout
          </Button>
        )}

        {isStaff && (
          <Button color="inherit" href="/">
            Back to Client
          </Button>
        )}
      </Toolbar>
    </AppBar>

    <Container maxWidth="lg" sx={{ py: 3 }}>
      {/* STAFF LOGIN */}
      {isStaff && !staffAllowed && (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2, maxWidth: 420 }}>
          <Typography variant="h6" sx={{ fontWeight: 900, mb: 1 }}>
            Staff / Admin Access
          </Typography>

          <Box component="form" onSubmit={tryStaffLogin} sx={{ display: "grid", gap: 1.5 }}>
            <TextField
              label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <Button type="submit" variant="contained" sx={{ fontWeight: 900 }}>
              Login
            </Button>
          </Box>

          <Typography variant="body2" sx={{ mt: 1, opacity: 0.7 }}>
            Staff access requires login.
          </Typography>
        </Paper>
      )}

      {/* CLIENT UI */}
      {!isStaff && (
        <Grid container spacing={2.5} alignItems="flex-start">
          <Grid item xs={12}>
            <Box sx={{ maxWidth: 520, mx: "auto" }}>
              <Typography variant="h5" sx={{ fontWeight: 900, mb: 1 }}>
                Menu
              </Typography>
              <Typography sx={{ opacity: 0.75, mb: 2 }}>
                Tap an item to add it. Some items can be customized.
              </Typography>

              {/* Categories (top buttons) */}
              <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap" }}>
                {CATEGORIES.map((c) => (
                  <Button
                    key={c.key}
                    variant={activeCategory === c.key ? "contained" : "outlined"}
                    onClick={() => setActiveCategory(c.key)}
                    sx={{ borderRadius: 999, fontWeight: 900 }}
                  >
                    {c.label}
                  </Button>
                ))}
              </Stack>

              {/* Products list (ONLY active category) */}
              <Stack spacing={1.2}>
                {productsDb
  .filter((p) => p.active !== false)
  .filter((p) => getCategory(p) === activeCategory)
  .map((product) => {
    const isConfigurable =
      !!product?.config &&
      (product.config?.salads?.enabled || (product.config?.options?.length ?? 0) > 0);

    return (
      <Fade in timeout={300} key={product.id}>
        <Paper
          variant="outlined"
          sx={{
            p: 1.25,
            borderRadius: 3,
            transition: "all 0.2s ease",
            "&:hover": {
              transform: "scale(1.02)",
              boxShadow: 3
            },
            "&:active": {
              transform: "scale(0.98)"
            }
          }}
        >
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={2}
          >
            <Box>
              <Typography sx={{ fontWeight: 900 }}>
                {product.name}
              </Typography>

              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                {formatEUR(product.price)}
              </Typography>
            </Box>

            <Button
              variant={isConfigurable ? "outlined" : "contained"}
              sx={{
                borderRadius: 999,
                fontWeight: 900,
                px: 2,
                textTransform: "none",
                boxShadow: isConfigurable ? 0 : 2
              }}
              onClick={() => {
                if (isConfigurable) openConfigurator(product);
                else addToCart(product);
              }}
            >
              {isConfigurable ? "Customize →" : "Add +"}
            </Button>
          </Stack>
        </Paper>
      </Fade>
    );
  })}
              </Stack>
            </Box>
          </Grid>

          {/* 🔥 CART BAR (sticky bottom) */}
          {cart.length > 0 && !cartOpen && !configOpen && (
            <Paper
              elevation={6}
              sx={{
                position: "fixed",
                left: 12,
                right: 12,
                bottom: 12,
                borderRadius: 999,
                px: 1.5,
                py: 1,
                zIndex: (theme) => theme.zIndex.modal - 1
              }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                <Box>
                  <Typography sx={{ fontWeight: 900, lineHeight: 1.1 }}>
                    Cart • {cart.length} item{cart.length === 1 ? "" : "s"}
                  </Typography>
                  <Typography variant="body2" sx={{ opacity: 0.75 }}>
                    Total: {formatEUR(total)}
                  </Typography>
                </Box>

                <Button
                  variant="contained"
                  sx={{ borderRadius: 999, fontWeight: 900, px: 2.2 }}
                  onClick={() => setCartOpen(true)}
                >
                  Checkout
                </Button>
              </Stack>
            </Paper>
          )}

          {/* 🧺 CART DRAWER */}
          <Drawer
            anchor="bottom"
            open={cartOpen}
            onClose={() => setCartOpen(false)}
            PaperProps={{
              sx: {
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                pb: 0,
                maxHeight: "92vh"
              }
            }}
          >
            <Box sx={{ display: "flex", flexDirection: "column", height: "92vh" }}>
              {/* HEADER */}
              <Box sx={{ p: 2 }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography variant="h6" sx={{ fontWeight: 900 }}>
                    Your Cart
                  </Typography>

                  <IconButton onClick={() => setCartOpen(false)}>
                    <CloseIcon />
                  </IconButton>
                </Stack>
                <Divider sx={{ mt: 2 }} />
              </Box>

              {/* SCROLL AREA */}
              <Box sx={{ px: 2, pb: 2, overflow: "auto" }}>
                {cart.length === 0 ? (
                  <Typography sx={{ opacity: 0.75 }}>Your cart is empty.</Typography>
                ) : (
                  <Stack spacing={1}>
                    {cart.map((item, index) => (
                      <Paper
  key={item.id ?? index}
  variant="outlined"
  sx={{
    p: 1.25,
    borderRadius: 3,
    transition: "all 0.2s ease",
    "&:hover": {
      transform: "scale(1.02)",
      boxShadow: 3
    },
    "&:active": {
      transform: "scale(0.98)"
    }
  }}
>
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
                            <Typography variant="body2" sx={{ opacity: 0.75 }}>
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
                  <Typography sx={{ fontWeight: 900, fontSize: 18 }}>{formatEUR(total)}</Typography>
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
              </Box>

              {/* STICKY FOOTER */}
              <Box
                sx={{
                  p: 2,
                  pt: 1.5,
                  borderTop: "1px solid rgba(0,0,0,0.08)",
                  backgroundColor: "background.paper"
                }}
              >
                <Button
                  fullWidth
                  variant="contained"
                  sx={{ borderRadius: 2, py: 1.2, fontWeight: 900 }}
                  disabled={!canPlaceOrder}
                  onClick={async () => {
                    await placeOrder();
                    setCartOpen(false);
                  }}
                >
                  Pay & Place order
                </Button>

                {!canPlaceOrder && (
                  <Typography sx={{ mt: 1, opacity: 0.75 }}>
                    Add items and choose a pickup time.
                  </Typography>
                )}

                {publicOrder && (
                  <Paper
                    variant="outlined"
                    sx={{
                      mt: 1.5,
                      p: 1.25,
                      borderRadius: 2,
                      borderWidth: publicOrder.status === "Gata" ? 2 : 1,
                      opacity: 0.95,
                      background:
                        publicOrder.status === "Gata"
                          ? "#e8f5e9"
                          : publicOrder.status === "In lucru"
                          ? "#fff8e1"
                          : "#e3f2fd"
                    }}
                  >
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                      <Typography sx={{ fontWeight: 900 }}>Status: {publicOrder.status}</Typography>

                      <Chip
                        label={publicOrder.status}
                        color={chipColor(publicOrder.status)}
                        icon={chipIcon(publicOrder.status)}
                        size="small"
                      />
                    </Stack>

                    {publicOrder.status === "Gata" && (
                      <Typography sx={{ mt: 0.5, fontWeight: 800 }}>✅ Ready for pickup!</Typography>
                    )}
                  </Paper>
                )}
              </Box>
            </Box>
          </Drawer>
        </Grid>
      )}

      {/* STAFF UI */}
      {isStaff && staffAllowed && (
        <Box>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2, flexWrap: "wrap" }}>
            <Tabs value={staffTab} onChange={(_, v) => setStaffTab(v)}>
              <Tab label="Orders" value="orders" />
              {isAdminRole && <Tab label="Products" value="products" />}
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
            <Box>
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

                    <Box
  sx={{
    position: "sticky",
    top: 64,
    zIndex: 10,
    bgcolor: "background.paper",
    pb: 1,
    mb: 2
  }}
>
  <Stack direction="row" spacing={1} sx={{ overflowX: "auto" }}>
    
                      <Button variant="outlined" onClick={() => setStatus(order.id, order.code, "Nou")}>
                        Nou
                      </Button>
                      <Button variant="outlined" onClick={() => setStatus(order.id, order.code, "In lucru")}>
                        In lucru
                      </Button>
                      <Button variant="contained" onClick={() => setStatus(order.id, order.code, "Gata")}>
                        Gata
                      </Button>
                    </Stack>
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Box>
          )}

          {staffTab === "products" && isAdminRole && (
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 800, mb: 1 }}>
                Products (Admin)
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
  select
  label="Category"
  value={newCategory}
  onChange={(e) => setNewCategory(e.target.value)}
  size="small"
  sx={{ width: 160 }}
>
  <MenuItem value="rolls">ROLLS</MenuItem>
  <MenuItem value="sides">SIDES</MenuItem>
  <MenuItem value="drinks">DRINKS</MenuItem>
</TextField>
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
                        disabled={!isAdminRole}
                      />
<TextField
    select
    label="Category"
    size="small"
    value={getCategory(p)}
    sx={{ width: 160 }}
    onChange={(e) => updateProductCategory(p, e.target.value)}
    disabled={!isAdminRole}
  >
    <MenuItem value="rolls">ROLLS</MenuItem>
    <MenuItem value="sides">SIDES</MenuItem>
    <MenuItem value="drinks">DRINKS</MenuItem>
  </TextField>
                      <Button variant="outlined" onClick={() => toggleProductActive(p)} disabled={!isAdminRole}>
                        {p.active === false ? "Activate" : "Deactivate"}
                      </Button>

                      {isAdminRole && (
                        <Button variant="outlined" onClick={() => openEditConfig(p)}>
                          Edit config
                        </Button>
                      )}

                      <Button
                        variant="outlined"
                        color="error"
                        onClick={() => removeProduct(p)}
                        disabled={!isAdminRole}
                      >
                        Delete
                      </Button>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Box>
          )}
        </Box>
      )}
    </Container>

    {/* EDIT CONFIG DIALOG */}
    <Dialog open={editOpen} onClose={() => setEditOpen(false)} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 900 }}>
        Edit config: {editProduct?.name || ""}
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2}>
          <FormControlLabel
            control={
              <Checkbox
                checked={cfgSaladsEnabled}
                onChange={(e) => setCfgSaladsEnabled(e.target.checked)}
              />
            }
            label="Enable salads"
          />

          <Stack direction="row" spacing={1}>
            <TextField
              label="Included salads"
              value={cfgSaladsIncluded}
              onChange={(e) => setCfgSaladsIncluded(e.target.value)}
              fullWidth
            />
            <TextField
              label="Extra price (€)"
              value={cfgSaladsExtraPrice}
              onChange={(e) => setCfgSaladsExtraPrice(e.target.value)}
              fullWidth
            />
          </Stack>

          <TextField
            label="Salads list (one per line)"
            value={cfgSaladsItemsText}
            onChange={(e) => setCfgSaladsItemsText(e.target.value)}
            multiline
            minRows={6}
            fullWidth
          />

          <Divider />

          <TextField
            label="Options (one per line): key|label|type(single/multi)|required(true/false)|items(comma)"
            value={cfgOptionsText}
            onChange={(e) => setCfgOptionsText(e.target.value)}
            multiline
            minRows={6}
            fullWidth
          />
        </Stack>
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button variant="outlined" onClick={() => setEditOpen(false)}>
          Cancel
        </Button>
        <Button variant="contained" sx={{ fontWeight: 900 }} onClick={saveEditConfig}>
          Save
        </Button>
      </DialogActions>
    </Dialog>

    {/* SNACKBAR */}
    <Snackbar
      open={snack.open}
      autoHideDuration={1400}
      onClose={() => setSnack({ open: false, msg: "" })}
      anchorOrigin={{ vertical: "top", horizontal: "center" }}
      sx={{ mt: 10 }}
    >
      <Alert
        severity="success"
        variant="filled"
        onClose={() => setSnack({ open: false, msg: "" })}
        sx={{ fontWeight: 800 }}
      >
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