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

function isWithinWorkingHours() {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();

  const minutesNow = h * 60 + m;

  const openMinutes = 7 * 60;   // 07:00
  const closeMinutes = 17 * 60; // 17:00

  return minutesNow >= openMinutes && minutesNow < closeMinutes;
}


export default function App() {
  // ===== MODE =====
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") || "client";
  const isStaff = mode === "staff";
const [lastPublicStatus, setLastPublicStatus] = useState("");
const [cartOpen, setCartOpen] = useState(false);
const [publicOrder, setPublicOrder] = useState(null);
const [isOpen, setIsOpen] = useState(isWithinWorkingHours());

useEffect(() => {
  const interval = setInterval(() => {
    setIsOpen(isWithinWorkingHours());
  }, 60000); // verifică la 1 minut

  return () => clearInterval(interval);
}, []);
  // ===== AUTH (Email/Password) =====
const [authUser, setAuthUser] = useState(null);
const [email, setEmail] = useState("");
const [password, setPassword] = useState("");

// staff = orice user autentificat (pe /?mode=staff)
const staffAllowed = isStaff && !!authUser;

// admin = doar emailurile din listă
const isAdminRole = !!authUser?.email && ADMIN_EMAILS.includes(authUser.email);
 
function addDaysISO(isoDate, deltaDays) {
  // isoDate: "YYYY-MM-DD"
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return toLocalISODate(dt);
}

function ReportsPanel({ orders }) {
  const todayStr = toLocalISODate(new Date());

  const [fromDate, setFromDate] = useState(todayStr);
  const [toDate, setToDate] = useState(todayStr);

  const filtered = useMemo(() => {
    const list = Array.isArray(orders) ? orders : [];
    return list.filter((o) => {
      const d = o.pickupDate || ""; // "YYYY-MM-DD"
      if (!d) return false;
      return d >= fromDate && d <= toDate;
    });
  }, [orders, fromDate, toDate]);

  const totalOrders = filtered.length;
  const totalRevenue = filtered.reduce((s, o) => s + Number(o.total || 0), 0);
const avgOrder = totalOrders === 0 ? 0 : totalRevenue / totalOrders;

  const statusCount = useMemo(() => {
    const map = { Nou: 0, "In lucru": 0, Gata: 0, Other: 0 };
    filtered.forEach((o) => {
      const st = o.status || "Other";
      if (map[st] === undefined) map.Other += 1;
      else map[st] += 1;
    });
    return map;
  }, [filtered]);

  const topProducts = useMemo(() => {
    const m = new Map();
    filtered.forEach((o) => {
      (o.items || []).forEach((it) => {
        const name = it.name || it.displayName || "Unknown";
        m.set(name, (m.get(name) || 0) + 1);
      });
    });

    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
  }, [filtered]);

const topProductsRevenue = useMemo(() => {
  const m = new Map();

  filtered.forEach((o) => {
    (o.items || []).forEach((it) => {
      const name = it.name || it.displayName || "Unknown";
      const value = Number(it.price || 0);

      m.set(name, (m.get(name) || 0) + value);
    });
  });

  return Array.from(m.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
}, [filtered]);

  const topSlots = useMemo(() => {
    const m = new Map();
    filtered.forEach((o) => {
      const slot = o.pickupTime || "Unknown";
      m.set(slot, (m.get(slot) || 0) + 1);
    });
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [filtered]);

  function exportCSV() {
  const rows = [];

  // Header "report"
  rows.push(["REPORT"]);
  rows.push(["From", fromDate, "To", toDate]);
  rows.push(["Orders", String(totalOrders), "Revenue", String(Number(totalRevenue || 0).toFixed(2))]);
  rows.push([]);

  // Orders table
  rows.push(["ORDERS"]);
  rows.push(["code", "pickupDate", "pickupTime", "status", "total", "itemsCount"]);
  filtered.forEach((o) => {
    rows.push([
      o.code || "",
      o.pickupDate || "",
      o.pickupTime || "",
      o.status || "",
      String(Number(o.total || 0).toFixed(2)),
      String((o.items || []).length)
    ]);
  });
  rows.push([]);

  // Top products (qty)
  rows.push(["TOP PRODUCTS (QTY)"]);
  rows.push(["product", "qty"]);
  topProducts.forEach(([name, qty]) => rows.push([name, String(qty)]));
  rows.push([]);

  // Top products (revenue)
  rows.push(["TOP PRODUCTS (REVENUE)"]);
  rows.push(["product", "revenue"]);
  topProductsRevenue.forEach(([name, value]) =>
    rows.push([name, String(Number(value || 0).toFixed(2))])
  );

  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `report_${fromDate}_to_${toDate}.csv`;
  a.click();

  URL.revokeObjectURL(url);
  }
function exportPDF() {
  const htmlTopQty = topProducts
    .map(([name, qty]) => `<tr><td>${escapeHtml(name)}</td><td style="text-align:right;font-weight:700;">${qty}</td></tr>`)
    .join("");

  const htmlTopRev = topProductsRevenue
    .map(([name, value]) => `<tr><td>${escapeHtml(name)}</td><td style="text-align:right;font-weight:700;">${escapeHtml(formatEUR(value))}</td></tr>`)
    .join("");

  const htmlOrders = filtered
    .map((o) => `
      <tr>
        <td>${escapeHtml(o.code)}</td>
        <td>${escapeHtml(o.pickupDate)}</td>
        <td>${escapeHtml(o.pickupTime)}</td>
        <td>${escapeHtml(o.status)}</td>
        <td style="text-align:right;font-weight:700;">${escapeHtml(formatEUR(o.total || 0))}</td>
      </tr>
    `)
    .join("");

  const docHtml = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Report ${escapeHtml(fromDate)} to ${escapeHtml(toDate)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    body { font-family: Arial, sans-serif; color: #111; }
    h1 { font-size: 18px; margin: 0 0 6px; }
    .muted { opacity: 0.75; font-size: 12px; margin-bottom: 12px; }
    .cards { display: flex; gap: 10px; margin: 12px 0 14px; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 10px; min-width: 160px; }
    .label { font-size: 12px; opacity: 0.75; }
    .value { font-size: 18px; font-weight: 900; margin-top: 4px; }
    h2 { font-size: 14px; margin: 16px 0 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #eee; padding: 6px 4px; font-size: 12px; }
    th { text-align: left; font-size: 12px; opacity: 0.8; }
    .twoCol { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  </style>
</head>
<body>
  <h1>Deli Order — Report</h1>
  <div class="muted">Range: <b>${escapeHtml(fromDate)}</b> → <b>${escapeHtml(toDate)}</b></div>

  <div class="cards">
    <div class="card"><div class="label">Orders</div><div class="value">${totalOrders}</div></div>
    <div class="card"><div class="label">Revenue</div><div class="value">${escapeHtml(formatEUR(totalRevenue))}</div></div>
  </div>

  <div class="twoCol">
    <div>
      <h2>Top products (Qty)</h2>
      <table>
        <thead><tr><th>Product</th><th style="text-align:right;">Qty</th></tr></thead>
        <tbody>${htmlTopQty || `<tr><td colspan="2" class="muted">No data</td></tr>`}</tbody>
      </table>
    </div>

    <div>
      <h2>Top products (Revenue)</h2>
      <table>
        <thead><tr><th>Product</th><th style="text-align:right;">Revenue</th></tr></thead>
        <tbody>${htmlTopRev || `<tr><td colspan="2" class="muted">No data</td></tr>`}</tbody>
      </table>
    </div>
  </div>

  <h2>Orders</h2>
  <table>
    <thead>
      <tr>
        <th>Code</th><th>Date</th><th>Slot</th><th>Status</th><th style="text-align:right;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${htmlOrders || `<tr><td colspan="5" class="muted">No orders in selected range</td></tr>`}
    </tbody>
  </table>

  <script>
    window.onload = () => { window.print(); };
  </script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=900,height=700");
  w.document.open();
  w.document.write(docHtml);
  w.document.close();
}

    
    function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
   useEffect(() => {
  const saved = localStorage.getItem("lastOrderCode");
  if (saved) setOrderCode(saved);
}, []);

  return (
  <Box>
    <Typography variant="h5" sx={{ fontWeight: 900, mb: 2 }}>
      Reports
    </Typography>

    <Typography sx={{ opacity: 0.7, mb: 2 }}>
      Showing: <b>{fromDate}</b> → <b>{toDate}</b>
    </Typography>

    
    {filtered.length === 0 && (
      <Alert severity="info" sx={{ mb: 2 }}>
        No orders in the selected date range.
      </Alert>
    )}

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2 }}>
        <Stack direction="row" spacing={1.5} flexWrap="wrap" alignItems="center">
          <TextField
            label="From"
            type="date"
            size="small"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            label="To"
            type="date"
            size="small"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />

          <Button
            variant="outlined"
            onClick={() => {
              setFromDate(todayStr);
              setToDate(todayStr);
            }}
          >
            Today
          </Button>

<Button
  variant="outlined"
  onClick={() => {
    console.log("CLICK YESTERDAY");
    const y = addDaysISO(todayStr, -1);
    console.log("YESTERDAY =", y);
    setFromDate(y);
    setToDate(y);
  }}
>
  Yesterday
</Button>

<Button
  variant="outlined"
  onClick={() => {
    const from = addDaysISO(todayStr, -6); // last 7 days incl. today
    setFromDate(from);
    setToDate(todayStr);
  }}
>
  Last 7 days
</Button>

          <Button variant="contained" onClick={exportCSV} sx={{ fontWeight: 900, ml: "auto" }}>
            Export CSV
          </Button>
          <Button variant="outlined" onClick={exportPDF}>
  Export PDF
</Button>
        </Stack>
      </Paper>

      <Stack direction="row" spacing={2} flexWrap="wrap" sx={{ mb: 2 }}>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, minWidth: 220 }}>
          <Typography sx={{ opacity: 0.7 }}>Orders</Typography>
          <Typography sx={{ fontWeight: 900, fontSize: 28 }}>{totalOrders}</Typography>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, minWidth: 220 }}>
          <Typography sx={{ opacity: 0.7 }}>Revenue</Typography>
          <Typography sx={{ fontWeight: 900, fontSize: 28 }}>
            {formatEUR(totalRevenue)}
          </Typography>
        </Paper>
<Paper variant="outlined" sx={{ p: 2, borderRadius: 3, minWidth: 220 }}>
  <Typography sx={{ opacity: 0.7 }}>Avg order</Typography>
  <Typography sx={{ fontWeight: 900, fontSize: 28 }}>
    {formatEUR(avgOrder)}
  </Typography>
</Paper>


        <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, minWidth: 260 }}>
          <Typography sx={{ opacity: 0.7, mb: 1 }}>By status</Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Chip label={`Nou: ${statusCount.Nou}`} />
            <Chip label={`In lucru: ${statusCount["In lucru"]}`} />
            <Chip label={`Gata: ${statusCount.Gata}`} />
          </Stack>
        </Paper>
      </Stack>

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Typography sx={{ fontWeight: 900, mb: 1 }}>Top products</Typography>
            {topProducts.length === 0 ? (
              <Typography sx={{ opacity: 0.7 }}>No data in selected range.</Typography>
            ) : (
              <Stack spacing={0.75}>
                {topProducts.map(([name, qty]) => (
                  <Stack key={name} direction="row" justifyContent="space-between">
                    <Typography sx={{ pr: 1 }} noWrap>
                      {name}
                    </Typography>
                    <Typography sx={{ fontWeight: 900 }}>{qty}</Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Typography sx={{ fontWeight: 900, mb: 1 }}>Top pickup slots</Typography>
            {topSlots.length === 0 ? (
              <Typography sx={{ opacity: 0.7 }}>No data in selected range.</Typography>
            ) : (
              <Stack spacing={0.75}>
                {topSlots.map(([slot, qty]) => (
                  <Stack key={slot} direction="row" justifyContent="space-between">
                    <Typography sx={{ pr: 1 }} noWrap>
                      {slot}
                    </Typography>
                    <Typography sx={{ fontWeight: 900 }}>{qty}</Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
  <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
    <Typography sx={{ fontWeight: 900, mb: 1 }}>
      Top products by revenue
    </Typography>

    {topProductsRevenue.length === 0 ? (
      <Typography sx={{ opacity: 0.7 }}>
        No data in selected range.
      </Typography>
    ) : (
      <Stack spacing={0.75}>
        {topProductsRevenue.map(([name, value]) => (
          <Stack key={name} direction="row" justifyContent="space-between">
            <Typography sx={{ pr: 1 }} noWrap>
              {name}
            </Typography>
            <Typography sx={{ fontWeight: 900 }}>
              {formatEUR(value)}
            </Typography>
          </Stack>
        ))}
      </Stack>
    )}
  </Paper>
</Grid>
      </Grid>
    </Box>
  );
}

function toLocalISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}



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
  const [ordersAll, setOrdersAll] = useState([]);
  const [orders, setOrders] = useState([]);
  const [productsDb, setProductsDb] = useState([]);
const [publicOrders, ] = useState([]);
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
 function slotStartMinutes(label) {
  const start = label.split("-")[0].trim();
  const [hh, mm] = start.split(":").map(Number);
  return hh * 60 + mm;
}

function isSlotWithinWorkingHours(label) {
  const startMin = slotStartMinutes(label);
  const openMin = 7 * 60;
  const closeMin = 17 * 60;
  return startMin >= openMin && startMin < closeMin;
}
  // ===== LIVE ORDERS =====
  useEffect(() => {
  if (!isStaff || !staffAllowed) {
    setOrders([]);
    setOrdersAll([]);
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
      setOrdersAll(list); 
const shown = showOnlyOpen
  ? list.filter((o) => o.status !== "Gata")
  : list;

setOrders(shown);
    },
    (err) => {
      console.error("[ORDERS] ERROR =", err);
    }
  );

  return () => {
    console.log("[ORDERS] unsub");
    unsub();
  };
}, [isStaff, staffAllowed, showOnlyOpen]);
  
  
  
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
    
    
    setCart((prev) => [...prev, item]);
    setSnack({ open: true, msg: "Added to cart" });
  }

  function removeFromCart(indexToRemove) {
    
    
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
localStorage.setItem("lastOrderCode", code);
    setSnack({ open: true, msg: `Order placed • Code: ${code}` });
console.log("ORDER CODE =", code);
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

const codeToShow = publicOrder?.code || orderCode;
const statusToShow = publicOrder?.status || null;

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
              {!isOpen && (
  <Alert severity="warning" sx={{ mb: 2, borderRadius: 3 }}>
    We are closed now. Orders available daily between <b>07:00</b> – <b>17:00</b>.
  </Alert>
)}
{codeToShow && (
  <Paper
    variant="outlined"
    sx={{
      p: 1.25,
      borderRadius: 3,
      mb: 2,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 1.5
    }}
  >
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontWeight: 900 }}>
        Order code: <span style={{ letterSpacing: 2, fontSize: 18 }}>
  {codeToShow}
</span>
      </Typography>
      <Typography variant="body2" sx={{ opacity: 0.75 }}>
        Keep this code to track your order status.
      </Typography>
    </Box>

    {statusToShow && (
      <Chip
        label={statusToShow}
        color={chipColor(statusToShow)}
        icon={chipIcon(statusToShow)}
        size="small"
        sx={{ fontWeight: 900, flexShrink: 0 }}
      />
    )}
    <Button
  size="small"
  variant="text"
  sx={{ fontWeight: 900, flexShrink: 0 }}
  onClick={() => {
    setOrderCode("");
    setPublicOrder(null);
    localStorage.removeItem("lastOrderCode");
  }}
>
  Clear
</Button>
  </Paper>
)}
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
  .filter((p) => getCategory(p) === activeCategory)
  .map((product) => {
    const isConfigurable =
      !!product?.config &&
      (product.config?.salads?.enabled ||
        (product.config?.options?.length ?? 0) > 0);

    const isOut = product.active === false;

    return (
      <Fade in timeout={300} key={product.id}>
        <Paper
          variant="outlined"
          sx={{
            p: 1.25,
            borderRadius: 3,
    position: "relative", 
    opacity: isOut ? 0.55 : 1,
    transition: "all 0.2s ease",
            ...(isOut
              ? {}
              : {
                  "&:hover": {
                    transform: "scale(1.02)",
                    boxShadow: 3
                  },
                  "&:active": {
                    transform: "scale(0.98)"
                  }
                })
          }}
        >
          {isOut && (
  <Chip
  label="Out of stock"
  size="small"
  sx={{
    position: "absolute",
    top: -10,
    right: 10,
    fontWeight: 800,
    bgcolor: "#111",
    color: "#fff",
    zIndex: 2
  }}
/>
)}
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

            {!isOut && (
  <Button
    variant={isConfigurable ? "outlined" : "contained"}
    sx={{
      borderRadius: 999,
      fontWeight: 900,
      px: 2,
      textTransform: "none",
      boxShadow: isConfigurable ? 0 : 2
    }}
    disabled={!isOpen || isOut}
    onClick={() => {
      if (isConfigurable) openConfigurator(product);
      else addToCart(product);
    }}
  >
    {isConfigurable ? "Customize →" : "Add +"}
  </Button>
)}
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
      "&:active": { transform: "scale(0.98)" }
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

<Typography variant="body2" sx={{ opacity: 0.75, mb: 1 }}>
  Available daily between 07:00 – 17:00.
</Typography>

                <Stack spacing={1}>
                  {pickupSlots
  .filter((slot) => isSlotWithinWorkingHours(slot.label))
  .map((slot) => {
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
  {isAdminRole && <Tab label="Reports" value="reports" />} {/* 🔥 ASTA ADAUGI */}
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
  label={p.active === false ? "Out of stock" : "Available"}
  color={p.active === false ? "default" : "success"}
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
                      <Button
  variant={p.active === false ? "contained" : "outlined"}
  color={p.active === false ? "success" : "warning"}
  onClick={() => toggleProductActive(p)}
  disabled={!isAdminRole}
  sx={{ fontWeight: 900 }}
>
  {p.active === false ? "Back in stock" : "Out of stock"}
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

          {staffTab === "reports" && isAdminRole && (
  <ReportsPanel orders={ordersAll} />
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