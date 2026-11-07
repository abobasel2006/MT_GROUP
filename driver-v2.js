import { auth, functions, signInWithCustomToken, signOut, setPersistence, browserSessionPersistence, httpsCallable } from "./src/firebase.js";

const $ = selector => document.querySelector(selector);
const sessionKey = "mt_current_driver";
const loginPanel = $("#loginPanel");
const dashboard = $("#dashboard");
const select = $("#driverSelect");
const pinInput = $("#driverPin");
const loginButton = $("#loginButton");
const listDriverLoginOptions = httpsCallable(functions, "listDriverLoginOptions");
const loginWithPin = httpsCallable(functions, "loginWithPin");
const getMyActiveShift = httpsCallable(functions, "getMyActiveShift");
const startShiftCall = httpsCallable(functions, "startShift");
const endShiftCall = httpsCallable(functions, "endShift");
let loginOptions = [];
let currentDriver = null;
let activeShift = null;
let timerHandle = null;
let busy = false;

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
function renderSelect() {
  const previous = select.value;
  select.replaceChildren(new Option("اختر اسمك...", ""));
  for (const item of loginOptions) {
    const option = new Option(
      item.driverName + " — " + (item.plate || "سيارة") + " — الوردية " + shiftLabel(item.shiftType),
      JSON.stringify(item)
    );
    select.add(option);
  }
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
  updateLoginButton();
  $("#loginStatus").textContent = loginOptions.length
    ? "اختر اسمك وأدخل رمز PIN المكوّن من أربعة أرقام."
    : "لا توجد تعيينات نشطة للسائقين حالياً.";
}
function updateLoginButton() {
  loginButton.disabled = busy || !select.value || !/^\d{4}$/.test(pinInput.value);
}
function persistSession() {
  localStorage.setItem(sessionKey, JSON.stringify(currentDriver));
}
function activeShiftFor(driverId) {
  return currentDriver?.driverId === driverId ? activeShift : null;
}
function showDashboard() {
  loginPanel.hidden = true;
  dashboard.hidden = false;
  $("#welcome").textContent = currentDriver.driverName || "السائق";
  $("#assignment").textContent = (currentDriver.plate || "السيارة") + " — الوردية " + shiftLabel(currentDriver.shiftType);
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
async function refreshActiveShift() {
  const result = await getMyActiveShift();
  activeShift = result.data?.shift || null;
  renderShift();
}
function setBusy(value) {
  busy = value;
  $("#startButton").disabled = value;
  $("#endButton").disabled = value;
  $("#startButton").textContent = value ? "جارٍ التنفيذ..." : "بدء الوردية";
  $("#endButton").textContent = value ? "جارٍ التنفيذ..." : "إنهاء الوردية";
  updateLoginButton();
}

async function loadLoginOptions() {
  try {
    const result = await listDriverLoginOptions();
    loginOptions = Array.isArray(result.data?.options) ? result.data.options : [];
    renderSelect();
  } catch (error) {
    $("#loginStatus").textContent = "تعذر تحميل قائمة السائقين. تحقق من إعدادات Firebase.";
    console.error("listDriverLoginOptions:", error);
  }
}

loginButton.addEventListener("click", async () => {
  if (!select.value || !/^\d{4}$/.test(pinInput.value) || busy) return;
  let selected;
  try { selected = JSON.parse(select.value); }
  catch { $("#loginStatus").textContent = "تعذر قراءة اختيار السائق."; return; }
  busy = true;
  updateLoginButton();
  $("#loginStatus").textContent = "جارٍ التحقق من رمز PIN...";
  try {
    const result = await loginWithPin({ driverId: selected.driverId, pin: pinInput.value });
    await setPersistence(auth, browserSessionPersistence);
    await signInWithCustomToken(auth, result.data.token);
    const token = await auth.currentUser.getIdTokenResult(true);
    if (token.claims.role !== "driver" || token.claims.driverId !== selected.driverId) {
      throw new Error("تعذر مطابقة هوية السائق الموثوقة.");
    }
    currentDriver = selected;
    pinInput.value = "";
    persistSession();
    await refreshActiveShift();
    showDashboard();
  } catch (error) {
    $("#loginStatus").textContent = error.message || "رمز PIN غير صحيح أو تعذر تسجيل الدخول.";
    console.error("driver login:", error);
  } finally {
    busy = false;
    updateLoginButton();
  }
});
pinInput.addEventListener("input", updateLoginButton);
$("#logoutButton").addEventListener("click", async () => {
  try { await signOut(auth); } catch (error) { console.error(error); }
  localStorage.removeItem(sessionKey);
  currentDriver = null;
  activeShift = null;
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
  dashboard.hidden = true;
  loginPanel.hidden = false;
  $("#shiftState").textContent = "تم تسجيل الخروج.";
});

$("#startButton").addEventListener("click", async () => {
  if (busy || !currentDriver) return;
  const raw = $("#startOdometer").value.trim();
  const odometer = raw === "" ? null : Number(raw);
  if (odometer !== null && (!Number.isFinite(odometer) || odometer < 0)) return alert("أدخل قراءة عداد صحيحة.");
  setBusy(true);
  try {
    activeShift = (await startShiftCall({
      carId: currentDriver.carId, shiftType: currentDriver.shiftType, startOdometer: odometer
    })).data;
    $("#startOdometer").value = "";
    $("#shiftState").textContent = "تم بدء الوردية.";
  } catch (error) {
    alert(error.message || "تعذر بدء الوردية.");
  } finally {
    setBusy(false);
    await refreshActiveShift().catch(error => console.error(error));
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
    await endShiftCall({ shiftId: active.shiftId, endOdometer: odometer });
    activeShift = null;
    $("#endOdometer").value = "";
    $("#shiftState").textContent = "تم إنهاء الوردية بنجاح.";
  } catch (error) {
    alert(error.message || "تعذر إنهاء الوردية.");
  } finally {
    setBusy(false);
    await refreshActiveShift().catch(error => console.error(error));
  }
});

async function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(sessionKey) || "null");
    if (!saved?.driverId || !saved?.carId || !["day", "night"].includes(saved.shiftType) || !auth.currentUser) return;
    const token = await auth.currentUser.getIdTokenResult(true);
    if (token.claims.role !== "driver" || token.claims.driverId !== saved.driverId) {
      await signOut(auth);
      localStorage.removeItem(sessionKey);
      return;
    }
    currentDriver = saved;
    await refreshActiveShift();
    showDashboard();
  } catch (error) {
    console.error("restore driver session:", error);
    localStorage.removeItem(sessionKey);
    currentDriver = null;
  }
}

await loadLoginOptions();
await restoreSession();
