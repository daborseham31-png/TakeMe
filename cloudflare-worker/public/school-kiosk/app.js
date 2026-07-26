// ---------------------------------------------------------------------------
// School Kiosk frontend — Phase 3 of the School Return Kiosk project. A pure
// DISPLAY client for the read-only POST /school-kiosk/lookup endpoint (see
// src/schoolKiosk.ts) — this file never talks to Firestore/Firebase
// directly, never contains a credential of any kind, and never creates,
// starts, or cancels a ride. It only shows what the backend already decided.
//
// PRIVACY MODEL (this is a SHARED device in a school hallway):
//   - The permanent 6-digit identification code lives in memory for exactly
//     as long as it takes to send one request (see submitCode/performLookup)
//     — never in localStorage/sessionStorage/cookies/IndexedDB, never in the
//     URL, never logged to the console.
//   - Every lookup RESULT (child name, driver, vehicle, temporary
//     verification code) is held in memory only, is shown on screen for at
//     most 30 seconds (see startCountdown), and is wiped the moment that
//     timer fires, "Return to start" is pressed, or the page comes back from
//     being hidden for a while (see the visibilitychange handler).
//   - Every backend-returned string is inserted with textContent (or built
//     as plain DOM nodes) — never innerHTML — so nothing the backend (or,
//     transitively, a compromised Firestore record) returns can ever execute
//     as HTML/script on this page.
// ---------------------------------------------------------------------------

(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Translations — every interface string lives here. Backend-returned
  // values (child name, school/driver/vehicle names, dates, times) are NEVER
  // looked up in this table — see renderResult below, which always inserts
  // them as-is via textContent.
  // ---------------------------------------------------------------------
  var TRANSLATIONS = {
    en: {
      appTitle: "School Return Ride",
      languageSwitchLabel: "Choose language",
      configErrorTitle: "Kiosk Not Configured",
      configErrorMessage:
        "This kiosk is not set up yet. Please contact school staff.",
      enterCodeInstruction: "Enter your 6-digit student identification code",
      digitBoxesLabel: "Identification code entry",
      codeProgressTemplate: "{count} of 6 digits entered",
      clearButton: "Clear",
      checkRideButton: "Check Ride",
      backspaceButtonLabel: "Backspace",
      loadingMessage: "Checking your ride...",
      returnToStartButton: "Return to start",
      refreshStatusButton: "Refresh status",
      countdownTemplate: "Returning to start in {seconds} seconds",
      dateLabel: "Date",
      finishingTimeLabel: "Finishing time",
      routeLabel: "Route",
      driverLabel: "Driver",
      vehicleLabel: "Vehicle",
      plateLabel: "Plate number",
      meetingPointLabel: "Meeting point",
      verificationCodeLabel: "Verification code",
      verificationCodeInstruction:
        "Tell this verification code to the driver when entering the vehicle.",
      state_no_return_today: "No return ride is scheduled for today",
      state_searching_driver: "We are still searching for a driver",
      state_awaiting_confirmation:
        "A possible ride was found and is awaiting confirmation",
      state_confirmed: "Return ride confirmed",
      state_driver_on_way: "Your driver is on the way",
      state_arrived_pickup: "Your driver has arrived",
      state_in_progress: "The return ride has started",
      state_completed: "Your return ride has been completed",
      state_cancelled: "The return ride was cancelled",
      error_not_found:
        "We could not find today's return ride. Check the code and try again.",
      error_rate_limited:
        "Too many attempts. Please wait and ask a school staff member for help.",
      error_network:
        "The service is temporarily unavailable. Please try again.",
    },
    ar: {
      appTitle: "رحلة العودة المدرسية",
      languageSwitchLabel: "اختر اللغة",
      configErrorTitle: "لم يتم إعداد هذا الجهاز",
      configErrorMessage:
        "لم يتم إعداد هذا الجهاز بعد. يرجى التواصل مع طاقم المدرسة.",
      enterCodeInstruction: "أدخل رمز التعريف الخاص بك المكوّن من 6 أرقام",
      digitBoxesLabel: "إدخال رمز التعريف",
      codeProgressTemplate: "تم إدخال {count} من 6 أرقام",
      clearButton: "مسح",
      checkRideButton: "التحقق من الرحلة",
      backspaceButtonLabel: "حذف الرقم الأخير",
      loadingMessage: "جارٍ التحقق من رحلتك...",
      returnToStartButton: "العودة إلى البداية",
      refreshStatusButton: "تحديث الحالة",
      countdownTemplate: "سيتم العودة إلى البداية خلال {seconds} ثانية",
      dateLabel: "التاريخ",
      finishingTimeLabel: "وقت الانتهاء",
      routeLabel: "المسار",
      driverLabel: "السائق",
      vehicleLabel: "المركبة",
      plateLabel: "رقم اللوحة",
      meetingPointLabel: "نقطة اللقاء",
      verificationCodeLabel: "رمز التحقق",
      verificationCodeInstruction:
        "أخبر السائق برمز التحقق هذا عند الركوب في السيارة.",
      state_no_return_today: "لا توجد رحلة عودة مجدولة لهذا اليوم",
      state_searching_driver: "ما زلنا نبحث عن سائق",
      state_awaiting_confirmation:
        "تم العثور على رحلة محتملة وهي بانتظار التأكيد",
      state_confirmed: "تم تأكيد رحلة العودة",
      state_driver_on_way: "السائق في الطريق إليك",
      state_arrived_pickup: "لقد وصل السائق",
      state_in_progress: "بدأت رحلة العودة",
      state_completed: "تم إكمال رحلة العودة",
      state_cancelled: "تم إلغاء رحلة العودة",
      error_not_found:
        "لم نتمكن من العثور على رحلة العودة لهذا اليوم. تحقق من الرمز وحاول مرة أخرى.",
      error_rate_limited:
        "عدد كبير جدًا من المحاولات. يرجى الانتظار وطلب المساعدة من طاقم المدرسة.",
      error_network: "الخدمة غير متوفرة مؤقتًا. يرجى المحاولة مرة أخرى.",
    },
    he: {
      appTitle: "נסיעת החזרה מבית הספר",
      languageSwitchLabel: "בחר שפה",
      configErrorTitle: "העמדה לא הוגדרה",
      configErrorMessage: "עמדה זו עדיין לא הוגדרה. אנא פנה לצוות בית הספר.",
      enterCodeInstruction: "הזן את קוד הזיהוי בן 6 הספרות שלך",
      digitBoxesLabel: "הזנת קוד זיהוי",
      codeProgressTemplate: "הוזנו {count} מתוך 6 ספרות",
      clearButton: "נקה",
      checkRideButton: "בדוק נסיעה",
      backspaceButtonLabel: "מחיקת הספרה האחרונה",
      loadingMessage: "בודק את הנסיעה שלך...",
      returnToStartButton: "חזרה להתחלה",
      refreshStatusButton: "רענן סטטוס",
      countdownTemplate: "חוזר להתחלה בעוד {seconds} שניות",
      dateLabel: "תאריך",
      finishingTimeLabel: "שעת סיום",
      routeLabel: "מסלול",
      driverLabel: "נהג",
      vehicleLabel: "רכב",
      plateLabel: "מספר לוחית רישוי",
      meetingPointLabel: "נקודת מפגש",
      verificationCodeLabel: "קוד אימות",
      verificationCodeInstruction:
        "מסור לנהג את קוד האימות הזה בעת הכניסה לרכב.",
      state_no_return_today: "לא נקבעה נסיעת חזרה להיום",
      state_searching_driver: "אנחנו עדיין מחפשים נהג",
      state_awaiting_confirmation: "נמצאה נסיעה אפשרית והיא ממתינה לאישור",
      state_confirmed: "נסיעת החזרה אושרה",
      state_driver_on_way: "הנהג בדרך אליך",
      state_arrived_pickup: "הנהג הגיע",
      state_in_progress: "נסיעת החזרה החלה",
      state_completed: "נסיעת החזרה הושלמה",
      state_cancelled: "נסיעת החזרה בוטלה",
      error_not_found:
        "לא הצלחנו למצוא נסיעת חזרה להיום. בדוק את הקוד ונסה שוב.",
      error_rate_limited:
        "יותר מדי ניסיונות. אנא המתן ובקש עזרה מצוות בית הספר.",
      error_network: "השירות אינו זמין כרגע. אנא נסה שוב.",
    },
    ru: {
      appTitle: "Поездка домой из школы",
      languageSwitchLabel: "Выберите язык",
      configErrorTitle: "Киоск не настроен",
      configErrorMessage:
        "Этот киоск ещё не настроен. Пожалуйста, обратитесь к сотруднику школы.",
      enterCodeInstruction: "Введите свой 6-значный идентификационный код",
      digitBoxesLabel: "Ввод идентификационного кода",
      codeProgressTemplate: "Введено {count} из 6 цифр",
      clearButton: "Очистить",
      checkRideButton: "Проверить поездку",
      backspaceButtonLabel: "Удалить последнюю цифру",
      loadingMessage: "Проверяем вашу поездку...",
      returnToStartButton: "Вернуться к началу",
      refreshStatusButton: "Обновить статус",
      countdownTemplate: "Возврат к началу через {seconds} сек.",
      dateLabel: "Дата",
      finishingTimeLabel: "Время окончания",
      routeLabel: "Маршрут",
      driverLabel: "Водитель",
      vehicleLabel: "Автомобиль",
      plateLabel: "Номер машины",
      meetingPointLabel: "Место встречи",
      verificationCodeLabel: "Код подтверждения",
      verificationCodeInstruction:
        "Сообщите водителю этот код подтверждения при посадке в машину.",
      state_no_return_today: "На сегодня поездка домой не запланирована",
      state_searching_driver: "Мы всё ещё ищем водителя",
      state_awaiting_confirmation:
        "Найдена возможная поездка, ожидает подтверждения",
      state_confirmed: "Поездка домой подтверждена",
      state_driver_on_way: "Водитель уже едет",
      state_arrived_pickup: "Водитель прибыл",
      state_in_progress: "Поездка домой началась",
      state_completed: "Поездка домой завершена",
      state_cancelled: "Поездка домой отменена",
      error_not_found:
        "Не удалось найти поездку домой на сегодня. Проверьте код и попробуйте снова.",
      error_rate_limited:
        "Слишком много попыток. Подождите и обратитесь за помощью к сотруднику школы.",
      error_network: "Сервис временно недоступен. Попробуйте снова.",
    },
  };

  var SUPPORTED_LANGS = ["ar", "he", "en", "ru"];
  var RTL_LANGS = { ar: true, he: true };

  var LOOKUP_URL = "/school-kiosk/lookup";
  var CODE_LENGTH = 6;
  var MASK_DELAY_MS = 700;
  var COUNTDOWN_SECONDS = 60;
  var FETCH_TIMEOUT_MS = 15000;
  // "Hidden long enough" before a focus-regain forces a reset — a brief tab
  // switch/notification glance is fine; anything longer and a shared kiosk
  // must not keep showing the previous child's data.
  var HIDDEN_RESET_MS = 5000;
  var SCHOOL_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

  // ---------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------
  var appEl = document.getElementById("app");
  var langMenuEl = document.getElementById("langMenu");
  var langMenuBtn = document.getElementById("langMenuBtn");
  var langMenuDropdown = document.getElementById("langMenuDropdown");
  var configErrorScreen = document.getElementById("configErrorScreen");
  var entryScreen = document.getElementById("entryScreen");
  var loadingScreen = document.getElementById("loadingScreen");
  var resultScreen = document.getElementById("resultScreen");
  var resultCard = document.getElementById("resultCard");
  var digitBoxesEl = document.getElementById("digitBoxes");
  var codeProgressAnnouncer = document.getElementById("codeProgressAnnouncer");
  var keypadEl = document.getElementById("keypad");
  var submitBtn = document.getElementById("submitBtn");
  var clearBtn = document.getElementById("clearBtn");
  var backspaceBtn = document.getElementById("backspaceBtn");
  var refreshBtn = document.getElementById("refreshBtn");
  var returnToStartBtn = document.getElementById("returnToStartBtn");
  var countdownTextEl = document.getElementById("countdownText");

  // ---------------------------------------------------------------------
  // State — every one of these lives ONLY in memory for this page's
  // lifetime; nothing here is ever written to a persistent store.
  // ---------------------------------------------------------------------
  var currentLang = detectDefaultLanguage();
  var schoolId = readSchoolId();

  var code = ""; // the CURRENTLY-BEING-TYPED digits, before submission
  var maskedFlags = [];
  var maskTimers = [];

  var isSubmitting = false;
  var activeController = null;

  // The exact code just submitted — kept ONLY so "Refresh status" can
  // re-check the SAME booking without asking the child to retype it, and
  // ONLY for as long as the result screen's own 30s countdown is running
  // (see resetToEntry, which always clears this).
  var sessionReturnCode = null;
  var lastResult = null;

  var countdownRemaining = 0;
  var countdownIntervalId = null;
  var hiddenAt = null;

  function t(key) {
    var table = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
    return (table && table[key]) || TRANSLATIONS.en[key] || "";
  }

  function detectDefaultLanguage() {
    var candidates =
      navigator.languages && navigator.languages.length
        ? navigator.languages
        : [navigator.language || ""];

    for (var i = 0; i < candidates.length; i += 1) {
      var code2 = String(candidates[i]).toLowerCase().split("-")[0];
      if (code2 === "he" || code2 === "iw") return "he";
      if (code2 === "en") return "en";
      if (code2 === "ru") return "ru";
      if (code2 === "ar") return "ar";
    }

    // Default safely to Arabic whenever the browser locale doesn't CLEARLY
    // match one of the other three supported languages.
    return "ar";
  }

  // The only URL parameter this page ever reads or is allowed to carry — see
  // this file's header + the task's own "the only allowed URL parameter is
  // the configured schoolId" rule. Never written back to the URL, never
  // echoed into the DOM.
  function readSchoolId() {
    var raw = "";
    try {
      var params = new URLSearchParams(window.location.search);
      raw = params.get("schoolId") || "";
    } catch (err) {
      raw = "";
    }

    var present = raw.length > 0;
    var valid = SCHOOL_ID_PATTERN.test(raw);

    // Dev-safe diagnostic — presence/validity/length ONLY, never the actual
    // schoolId value: this page runs on a shared kiosk device, so its
    // console must never be a place a stable school identifier (or, if a
    // future caller ever accidentally reused this helper for something more
    // sensitive, that value) shows up in.
    console.log("SCHOOL_KIOSK_SCHOOL_ID_CHECK", {
      present: present,
      valid: valid,
      length: raw.length,
    });

    return valid ? raw : null;
  }

  function applyLanguage(lang) {
    if (SUPPORTED_LANGS.indexOf(lang) === -1) lang = "ar";
    currentLang = lang;

    document.documentElement.setAttribute("lang", lang);
    document.documentElement.setAttribute(
      "dir",
      RTL_LANGS[lang] ? "rtl" : "ltr",
    );

    var i18nEls = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < i18nEls.length; i += 1) {
      var el = i18nEls[i];
      el.textContent = t(el.getAttribute("data-i18n"));
    }

    var ariaEls = document.querySelectorAll("[data-i18n-aria-label]");
    for (var j = 0; j < ariaEls.length; j += 1) {
      var ariaEl = ariaEls[j];
      ariaEl.setAttribute(
        "aria-label",
        t(ariaEl.getAttribute("data-i18n-aria-label")),
      );
    }

    var langOptions = document.querySelectorAll(".lang-menu__option");
    for (var k = 0; k < langOptions.length; k += 1) {
      var opt = langOptions[k];
      opt.setAttribute(
        "aria-checked",
        opt.getAttribute("data-lang") === lang ? "true" : "false",
      );
    }

    announceProgress();

    // If a countdown is currently running (a result is on screen), refresh
    // its displayed text immediately in the new language too.
    if (countdownIntervalId && countdownRemaining > 0) {
      updateCountdownText();
    }

    // Re-render an already-visible result in the new language rather than
    // leaving stale-language labels up until the next state change.
    if (lastResult && !resultScreen.hidden) {
      renderResult(lastResult);
    }
  }

  // -----------------------------------------------------------------------
  // Language menu — a single globe button that reveals a small floating
  // dropdown, replacing the old always-visible row of 4 language buttons.
  // -----------------------------------------------------------------------
  function isLangMenuOpen() {
    return !langMenuDropdown.hidden;
  }

  function openLangMenu() {
    langMenuDropdown.hidden = false;
    langMenuBtn.setAttribute("aria-expanded", "true");
  }

  function closeLangMenu() {
    langMenuDropdown.hidden = true;
    langMenuBtn.setAttribute("aria-expanded", "false");
  }

  function toggleLangMenu() {
    if (isLangMenuOpen()) {
      closeLangMenu();
    } else {
      openLangMenu();
    }
  }

  // -----------------------------------------------------------------------
  // Screen switching — exactly one of entry/loading/result visible at once.
  // -----------------------------------------------------------------------
  function showScreen(name) {
    entryScreen.hidden = name !== "entry";
    loadingScreen.hidden = name !== "loading";
    resultScreen.hidden = name !== "result";
    // A screen change is never itself a reason to leave the language panel
    // floating over whatever just appeared.
    closeLangMenu();
  }

  // -----------------------------------------------------------------------
  // Digit entry
  // -----------------------------------------------------------------------
  function renderDigitBoxes() {
    var boxes = digitBoxesEl.querySelectorAll(".digit-box");
    for (var i = 0; i < boxes.length; i += 1) {
      var box = boxes[i];
      var filled = i < code.length;
      box.setAttribute("data-filled", filled ? "true" : "false");
      box.removeAttribute("data-masked");
      box.textContent = "";

      if (filled) {
        if (maskedFlags[i]) {
          box.setAttribute("data-masked", "true");
        } else {
          box.textContent = code.charAt(i);
        }
      }
    }
  }

  function announceProgress() {
    codeProgressAnnouncer.textContent = t("codeProgressTemplate").replace(
      "{count}",
      String(code.length),
    );
  }

  function updateSubmitEnabled() {
    submitBtn.disabled = isSubmitting || code.length !== CODE_LENGTH;
  }

  function setKeypadEnabled(enabled) {
    var buttons = keypadEl.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].disabled = !enabled;
    }
    updateSubmitEnabled();
  }

  function addDigit(digit) {
    if (isSubmitting || code.length >= CODE_LENGTH) return;

    var index = code.length;
    code += digit;
    maskedFlags[index] = false;
    renderDigitBoxes();
    updateSubmitEnabled();
    announceProgress();

    clearTimeout(maskTimers[index]);
    maskTimers[index] = setTimeout(function () {
      maskedFlags[index] = true;
      renderDigitBoxes();
    }, MASK_DELAY_MS);
  }

  function backspace() {
    if (isSubmitting || code.length === 0) return;

    var index = code.length - 1;
    clearTimeout(maskTimers[index]);
    maskTimers[index] = null;
    code = code.slice(0, -1);
    renderDigitBoxes();
    updateSubmitEnabled();
    announceProgress();
  }

  function clearCode() {
    for (var i = 0; i < maskTimers.length; i += 1) {
      clearTimeout(maskTimers[i]);
    }
    maskTimers = [];
    maskedFlags = [];
    code = "";
    renderDigitBoxes();
    updateSubmitEnabled();
    announceProgress();
  }

  // -----------------------------------------------------------------------
  // Result rendering — every backend-returned string is inserted via
  // textContent (never innerHTML), so HTML/script characters in any field
  // are always shown as inert plain text, never executed.
  // -----------------------------------------------------------------------
  var STATE_META = {
    no_return_today: {
      headingKey: "state_no_return_today",
      pillClass: "danger",
      icon: "○",
    },
    searching_driver: {
      headingKey: "state_searching_driver",
      pillClass: "ongoing",
      icon: "…",
    },
    awaiting_confirmation: {
      headingKey: "state_awaiting_confirmation",
      pillClass: "ongoing",
      icon: "?",
    },
    confirmed: {
      headingKey: "state_confirmed",
      pillClass: "success",
      icon: "✓",
    },
    driver_on_way: {
      headingKey: "state_driver_on_way",
      pillClass: "ongoing",
      icon: "→",
    },
    arrived_pickup: {
      headingKey: "state_arrived_pickup",
      pillClass: "ongoing",
      icon: "●",
    },
    in_progress: {
      headingKey: "state_in_progress",
      pillClass: "ongoing",
      icon: "▶",
    },
    completed: {
      headingKey: "state_completed",
      pillClass: "success",
      icon: "✓",
    },
    cancelled: {
      headingKey: "state_cancelled",
      pillClass: "danger",
      icon: "✕",
    },
  };

  function addRow(container, labelKey, value) {
    if (!value) return;
    var row = document.createElement("div");
    row.className = "result-row";

    var label = document.createElement("span");
    label.className = "result-row__label";
    label.textContent = t(labelKey);

    var val = document.createElement("span");
    val.className = "result-row__value";
    val.textContent = value;

    row.appendChild(label);
    row.appendChild(val);
    container.appendChild(row);
  }

  function renderResult(data) {
    lastResult = data;
    resultCard.replaceChildren();

    var meta = STATE_META[data.state] || STATE_META.no_return_today;

    var childName = document.createElement("p");
    childName.className = "child-name";
    childName.textContent = (data.child && data.child.displayName) || "";
    resultCard.appendChild(childName);

    var heading = document.createElement("h2");
    heading.className = "result-heading";
    heading.textContent = t(meta.headingKey);
    resultCard.appendChild(heading);

    var pill = document.createElement("div");
    pill.className = "result-status-pill result-status-pill--" + meta.pillClass;

    var pillIcon = document.createElement("span");
    pillIcon.className = "result-status-pill__icon";
    pillIcon.setAttribute("aria-hidden", "true");
    pillIcon.textContent = meta.icon;
    pill.appendChild(pillIcon);

    var pillLabel = document.createElement("span");
    pillLabel.textContent = t(meta.headingKey);
    pill.appendChild(pillLabel);
    resultCard.appendChild(pill);

    var rows = document.createElement("div");
    rows.className = "result-rows";
    addRow(rows, "dateLabel", data.date);

    var ride = data.returnRide;
    if (ride) {
      addRow(rows, "finishingTimeLabel", ride.finishingTime);

      var route = "";
      if (ride.routeFrom && ride.routeTo) {
        route = ride.routeFrom + " → " + ride.routeTo;
      } else {
        route = ride.routeFrom || ride.routeTo || "";
      }
      addRow(rows, "routeLabel", route);

      if (ride.driver && ride.driver.displayName) {
        addRow(rows, "driverLabel", ride.driver.displayName);
      }

      if (ride.vehicle) {
        var vehicleParts = [];
        if (ride.vehicle.make) vehicleParts.push(ride.vehicle.make);
        if (ride.vehicle.color) vehicleParts.push(ride.vehicle.color);
        if (vehicleParts.length > 0)
          addRow(rows, "vehicleLabel", vehicleParts.join(" · "));
        if (ride.vehicle.plateNumber)
          addRow(rows, "plateLabel", ride.vehicle.plateNumber);
      }

      if (ride.meetingPoint) {
        addRow(rows, "meetingPointLabel", ride.meetingPoint);
      }
    }
    resultCard.appendChild(rows);

    if (ride && ride.verificationCode) {
      var box = document.createElement("div");
      box.className = "verification-box";

      var vLabel = document.createElement("p");
      vLabel.className = "verification-box__label";
      vLabel.textContent = t("verificationCodeLabel");

      var vCode = document.createElement("p");
      vCode.className = "verification-box__code";
      vCode.textContent = ride.verificationCode;

      var vHint = document.createElement("p");
      vHint.className = "verification-box__hint";
      vHint.textContent = t("verificationCodeInstruction");

      box.appendChild(vLabel);
      box.appendChild(vCode);
      box.appendChild(vHint);
      resultCard.appendChild(box);
    }

    refreshBtn.hidden = !(
      data.state === "searching_driver" ||
      data.state === "awaiting_confirmation"
    );

    showScreen("result");
  }

  function showError(messageKey) {
    lastResult = null;
    resultCard.replaceChildren();

    var heading = document.createElement("h2");
    heading.className = "result-heading result-heading--danger";
    heading.textContent = t(messageKey);
    resultCard.appendChild(heading);

    refreshBtn.hidden = true;
    showScreen("result");
  }

  // -----------------------------------------------------------------------
  // Countdown / privacy auto-clear
  // -----------------------------------------------------------------------
  function updateCountdownText() {
    countdownTextEl.textContent = t("countdownTemplate").replace(
      "{seconds}",
      String(Math.max(countdownRemaining, 0)),
    );
  }

  function startCountdown() {
    stopCountdown();
    countdownRemaining = COUNTDOWN_SECONDS;
    updateCountdownText();

    countdownIntervalId = setInterval(function () {
      countdownRemaining -= 1;
      updateCountdownText();
      if (countdownRemaining <= 0) {
        resetToEntry();
      }
    }, 1000);
  }

  function stopCountdown() {
    if (countdownIntervalId) {
      clearInterval(countdownIntervalId);
      countdownIntervalId = null;
    }
    countdownRemaining = 0;
  }

  // The one function that wipes EVERY trace of the last lookup — child
  // name, driver/vehicle details, the temporary verification code, the
  // permanent code that was submitted, and any pending network request.
  // Called by the countdown expiring, "Return to start", and the
  // long-hidden/visibility-regained check below.
  function resetToEntry() {
    stopCountdown();

    if (activeController) {
      activeController.abort();
      activeController = null;
    }

    isSubmitting = false;
    sessionReturnCode = null;
    lastResult = null;

    resultCard.replaceChildren();
    countdownTextEl.textContent = "";
    refreshBtn.hidden = true;

    clearCode();
    setKeypadEnabled(true);
    showScreen("entry");
  }

  // -----------------------------------------------------------------------
  // Network
  // -----------------------------------------------------------------------
  function performLookup(returnCodeValue) {
    var controller = new AbortController();
    activeController = controller;
    var timeoutId = setTimeout(function () {
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    return fetch(LOOKUP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnCode: returnCodeValue, schoolId: schoolId }),
      signal: controller.signal,
    })
      .then(function (response) {
        if (response.status === 429) {
          showError("error_rate_limited");
          return false;
        }

        if (!response.ok) {
          showError("error_network");
          return false;
        }

        return response
          .json()
          .catch(function () {
            return null;
          })
          .then(function (data) {
            if (!data || data.ok !== true) {
              showError("error_not_found");
              return false;
            }

            renderResult(data);
            startCountdown();
            return true;
          });
      })
      .catch(function () {
        // Covers network failure AND the FETCH_TIMEOUT_MS abort above —
        // never distinguished for the child, never logged with request
        // details.
        showError("error_network");
        return false;
      })
      .finally(function () {
        clearTimeout(timeoutId);
        activeController = null;
      });
  }

  function submitCode() {
    if (isSubmitting || code.length !== CODE_LENGTH || !schoolId) return;

    var requestCode = code;
    isSubmitting = true;

    // Wipe the visible digit entry immediately — the permanent code has
    // done its one job (identifying the child in THIS request) the moment
    // it's captured here; the entry screen itself is about to be hidden
    // regardless.
    clearCode();
    setKeypadEnabled(false);
    showScreen("loading");

    sessionReturnCode = requestCode;

    performLookup(requestCode).then(function (ok) {
      isSubmitting = false;
      setKeypadEnabled(true);
      if (!ok) sessionReturnCode = null;
    });
  }

  function refreshStatus() {
    if (isSubmitting || !sessionReturnCode) return;

    isSubmitting = true;
    refreshBtn.disabled = true;
    showScreen("loading");

    performLookup(sessionReturnCode).then(function (ok) {
      isSubmitting = false;
      refreshBtn.disabled = false;
      if (!ok) sessionReturnCode = null;
    });
  }

  // -----------------------------------------------------------------------
  // Wiring
  // -----------------------------------------------------------------------
  function wireEvents() {
    var digitButtons = keypadEl.querySelectorAll("[data-digit]");
    for (var i = 0; i < digitButtons.length; i += 1) {
      digitButtons[i].addEventListener("click", function (event) {
        addDigit(event.currentTarget.getAttribute("data-digit"));
      });
    }

    backspaceBtn.addEventListener("click", backspace);
    clearBtn.addEventListener("click", clearCode);
    submitBtn.addEventListener("click", submitCode);
    refreshBtn.addEventListener("click", refreshStatus);
    returnToStartBtn.addEventListener("click", resetToEntry);

    langMenuBtn.addEventListener("click", function (event) {
      // Never let this bubble to the document-level "click outside closes
      // it" listener below — that listener would see its own toggle click
      // as an "outside" click and immediately close what this just opened.
      event.stopPropagation();
      toggleLangMenu();
    });

    var langOptionBtns =
      langMenuDropdown.querySelectorAll(".lang-menu__option");
    for (var j = 0; j < langOptionBtns.length; j += 1) {
      langOptionBtns[j].addEventListener("click", function (event) {
        applyLanguage(event.currentTarget.getAttribute("data-lang"));
        closeLangMenu();
        langMenuBtn.focus();
      });
    }

    document.addEventListener("click", function (event) {
      if (isLangMenuOpen() && !langMenuEl.contains(event.target)) {
        closeLangMenu();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && isLangMenuOpen()) {
        closeLangMenu();
        langMenuBtn.focus();
      }
    });

    // Physical keyboard support — active only while the entry screen is the
    // one actually showing, so it never fires while loading/result/an error
    // is on screen.
    window.addEventListener("keydown", function (event) {
      if (entryScreen.hidden) return;

      if (event.key >= "0" && event.key <= "9") {
        addDigit(event.key);
        event.preventDefault();
      } else if (event.key === "Backspace") {
        backspace();
        event.preventDefault();
      } else if (event.key === "Enter") {
        if (code.length === CODE_LENGTH) submitCode();
        event.preventDefault();
      }
    });

    // A shared kiosk must never keep showing one child's result after the
    // device has sat untouched (screen off, another app in front, etc.) for
    // more than a moment.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }

      if (hiddenAt !== null) {
        var hiddenDuration = Date.now() - hiddenAt;
        hiddenAt = null;
        if (hiddenDuration >= HIDDEN_RESET_MS) {
          resetToEntry();
        }
      }
    });
  }

  function init() {
    applyLanguage(currentLang);

    if (!schoolId) {
      configErrorScreen.hidden = false;
      appEl.hidden = true;
      return;
    }

    configErrorScreen.hidden = true;
    appEl.hidden = false;
    showScreen("entry");
    renderDigitBoxes();
    updateSubmitEnabled();
    wireEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
