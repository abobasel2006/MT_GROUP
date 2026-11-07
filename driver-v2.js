import { db, ref, onValue } from "./src/firebase.js";
import { startShift, endShift } from "./src/domain/shift-service.js";

const $ = selector => document.querySelector(selector);
const sessionKey = "mt_current_driver";
const loginPanel = $("#loginPanel");
const dashboard = $("#dashboard");
const select = $("#driverSelect");
const loginButton = $("#loginButton");
let fleet = { drivers: {}, cars: {} };
let shifts = { activeByCar: {}, activeByDriver: {}, history: {} };
let currentDriver = null;
let timerHandle = null;
let busy = false;

function safeText(value) { return String(value ?? ""); }
function shiftLabel(type) { return type === "day" ? "نهارية" : "ليلية"; }
function formatDate(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(Number(value)));
}
function formatDuration(start) {
  const seconds = Math.max(0, Math.floor((Date.now() - Number(start)) / 1000));
  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return h + ":" + m + ":" + s;
}
function isStillAssigned() {
  const driver = fleet.drivers?.[currentDriver?.driverId];
  const car = fleet.cars?.[currentDriver?.carId];
  const field = currentDriver?.shiftType === "day" ? "dayDriverId" : "nightDriverId";
  return !!(driver?.active === true && car?.active === true && car[field] === currentDriver.driverId);
}
function activeShiftFor(driverId) {
  const id = shifts.activeByDriver?.[driverId];
  return id ? shifts.history?.[id] || null : null;
}
function renderSelect() {
  const previous = select.value;
  select.replaceChildren(new Option("اختر اسمك...", ""));
  const options = [];
  for (const [carId, car] of Object.entries(fleet.cars || {})) {
    if (!car || car.active !== true) continue;
    for (const type of ["day", "night"]) {
      const driverId = car[type === "day" ? "dayDriverId" : "nightDriverId"];
      const driver = driverId ? fleet.drivers?.[driverId] : null;
      if (!driver || driver.active !== true) continue;
      options.push({ driverId, carId, shiftType: type, driverName: driver.name, plate: car.plate });
    }
  }
  options.sort((a,b) => a.driverName.localeCompare(b.driverName, "ar"));
  for (const item of options) {
    const option = new Option(`${item.driverName} — ${item.plate || "سيارة"} — ${shiftLabel(item.shiftType)}`, JSON.stringify(item));
    select.add(option);
  }
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
  loginButton.disabled = options.length === 0;
  if (!options.length) $("#loginStatus").textContent = "لا توجد تعيينات نشطة للسائقين حتى الآن.";
  else $("#loginStatus").textContent = "تم تحميل قائمة السائقين من قاعدة MT TAXI 2.0.";
}
function persistSession() {
  localStorage.setItem(sessionKey, JSON.stringify(currentDriver));
}
function showDashboard() {
  loginPanel.hidden = true;
  dashboard.hidden = false;
  const driver = fleet.drivers?.[currentDriver.driverId];
  const car = fleet.cars?.[currentDriver.carId];
  $("#welcome").textContent = driver?.name || currentDriver.driverName || "السائق";
  $("#assignment").textContent = `${car?.plate || currentDriver.plate || "السيارة"} — الوردية ${shiftLabel(currentDriver.shiftType)}`;
  renderShift();
}
function renderShift() {
  if (!currentDriver || dashboard.hidden) return;
  const active = activeShiftFor(currentDriver.driverId);
  const startBox = $("#startBox");
  const activeBox = $("#activeBox");
  if (active && active.status === "active") {
    startBox.hidden = true;
    activeBox.hidden = false;
    $("#shiftState").textContent = "لديك وردية نشطة حالياً.";
    $("#startedAt").textContent = formatDate(active.startedAt);
    $("#startedOdo").textContent = active.startOdometer == null ? "غير مسجل" : Number(active.startOdometer).toLocaleString("ar");
    if (timerHandle) clearInterval(timerHandle);
    $("#timer").textContent = formatDuration(active.startedAt);
    timerHandle = setInterval(() => { $("#timer").textContent = formatDuration(active.startedAt); }, 1000);
  } else {
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = null;
    activeBox.hidden = true;
    startBox.hidden = false;
    $("#shiftState").textContent = "لا توجد وردية نشطة على حسابك.";
  }
}
function setBusy(value) {
  busy = value;
  $("#startButton").disabled = value;
  $("#endButton").disabled = value;
  $("#startButton").textContent = value ? "جارٍ التنفيذ..." : "بدء الوردية";
  $("#endButton").textContent = value ? "جارٍ التنفيذ..." : "إنهاء الوردية";
}

loginButton.addEventListener("click", () => {
  if (!select.value) return;
  try {
    currentDriver = JSON.parse(select.value);
    persistSession();
    showDashboard();
  } catch (error) {
    $("#loginStatus").textContent = "تعذر قراءة اختيار السائق. أعد المحاولة.";
  }
});
$("#logoutButton").addEventListener("click", () => {
  localStorage.removeItem(sessionKey);
  currentDriver = null;
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
  dashboard.hidden = true;
  loginPanel.hidden = false;
});
$("#startButton").addEventListener("click", async () => {
  if (busy || !currentDriver) return;
  const raw = $("#startOdometer").value.trim();
  const odometer = raw === "" ? null : Number(raw);
  if (odometer !== null && (!Number.isFinite(odometer) || odometer < 0)) return alert("أدخل قراءة عداد صحيحة.");
  setBusy(true);
  try {
    await startShift({ driverId: currentDriver.driverId, carId: currentDriver.carId, shiftType: currentDriver.shiftType, startOdometer: odometer });
    $("#startOdometer").value = "";
    $("#shiftState").textContent = "تم بدء الوردية.";
  } catch (error) {
    alert(error.message || "تعذر بدء الوردية.");
  } finally {
    setBusy(false);
    renderShift();
  }
});
$("#endButton").addEventListener("click", async () => {
  if (busy || !currentDriver) return;
  const active = activeShiftFor(currentDriver.driverId);
  if (!active) return renderShift();
  const raw = $("#endOdometer").value.trim();
  const odometer = raw === "" ? null : Number(raw);
  if (odometer !== null && (!Number.isFinite(odometer) || odometer < 0)) return alert("أدخل قراءة عداد صحيحة.");
  if (odometer !== null && active.startOdometer !== null && odometer < Number(active.startOdometer)) return alert("عداد النهاية لا يمكن أن يكون أقل من عداد البداية.");
  if (!confirm("هل تريد إنهاء الوردية الآن؟")) return;
  setBusy(true);
  try {
    await endShift({ shiftId: active.shiftId, driverId: currentDriver.driverId, endOdometer: odometer });
    $("#endOdometer").value = "";
    $("#shiftState").textContent = "تم إنهاء الوردية بنجاح.";
  } catch (error) {
    alert(error.message || "تعذر إنهاء الوردية.");
  } finally {
    setBusy(false);
    renderShift();
  }
});

onValue(ref(db, "fleetState"), snapshot => {
  fleet = snapshot.val() || { drivers: {}, cars: {} };
  renderSelect();
  if (currentDriver) showDashboard();
}, error => {
  $("#loginStatus").textContent = "تعذر قراءة بيانات الأسطول. تحقق من قواعد Firebase قبل تشغيل النسخة.";
  console.error("fleetState listener:", error);
});
onValue(ref(db, "shiftState"), snapshot => {
  shifts = snapshot.val() || { activeByCar: {}, activeByDriver: {}, history: {} };
  if (currentDriver) renderShift();
}, error => {
  $("#shiftState").textContent = "تعذر قراءة حالة الورديات؛ قواعد Firebase قد تمنع الوصول.";
  console.error("shiftState listener:", error);
});

try {
  const saved = JSON.parse(localStorage.getItem(sessionKey) || "null");
  if (saved?.driverId && saved?.carId && ["day", "night"].includes(saved.shiftType)) {
    currentDriver = saved;
    showDashboard();
  }
} catch {
  localStorage.removeItem(sessionKey);
}
