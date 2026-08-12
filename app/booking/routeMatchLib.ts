// ---------------------------------------------------------------------------
// مطابقة الرحلات القائمة على المسار وتأخذ الانحراف بعين الاعتبار — تقريب
// هندسي محلي بالكامل ومجاني. لا اتصال بالشبكة، لا مفتاح API، لا خدمة توجيه
// مدفوعة، ولا أي فوترة من Google Cloud من أي نوع. كل دالة هنا نقية (pure)
// ومتزامنة (synchronous) — آمنة للاستدعاء مباشرة من useMemo وقت العرض.
//
// المصطلحات (انظر مواصفات الميزة نفسها): A = نقطة انطلاق السائق، C = وجهة
// السائق، B = نقطة استلام الراكب، D = وجهة الراكب. "مسار" السائق نفسه يُقرَّب
// كخط مستقيم من A إلى C (لا تتوفر هندسة طريق حقيقية بدون واجهة برمجية
// مدفوعة للتوجيه) — يتم مطابقة B عبر إسقاطها على هذا الخط (مسافة Haversine +
// إسقاط هندسي ثنائي الأبعاد)، ويُقرَّب الانحراف كـ
// distance(A,B)+distance(B,C)-distance(A,C) (أو صيغة A->B->D->C عندما تكون D
// معروفة ومختلفة عن C).
//
// app/booking/homeFeedLib.ts هو المستدعي الوحيد الذي يربط هذا الملف بواجهة
// الصفحة الرئيسية الفعلية، وليس العكس أبدًا (هذا الملف لا يستورد
// homeFeedLib.ts، تفاديًا لاستيراد دائري — انظر نوع DriverRouteInput الخاص
// به أدناه، وهو شكل مبسّط تحوّل إليه homeFeedLib.ts بيانات FeedItem الخاصة
// بها).
// ---------------------------------------------------------------------------

export type LatLng = { latitude: number; longitude: number };

// ---------------------------------------------------------------------------
// الإعدادات — كل قيمة حدّية تستخدمها هذه الميزة موجودة هنا، وهنا فقط. لا
// تكتب أبدًا نسخة منافسة مكررة من أي منها بأي مكوّن آخر.
// ---------------------------------------------------------------------------

// إلى أي مدى (المسافة العمودية، بالكيلومترات) يمكن أن تكون نقطة الاستلام أو
// الوجهة بعيدة عن ممر الخط المستقيم A->C وتظل تُحتسب بأنها "على الطريق".
export const MAX_ROUTE_CORRIDOR_DISTANCE_KM = 5;

// الحد الأقصى المطلق للانحراف التقريبي (كيلومترات إضافية بعد مسافة A->C)
// الذي يمكن أن تتحمّله الرحلة لاستلام/إنزال الراكب.
export const MAX_APPROXIMATE_DETOUR_KM = 8;

// حد نسبي — الانحراف التقريبي، كنسبة من مسافة A->C الخاصة بالسائق نفسه.
// يحمي الرحلات القصيرة حيث حتى انحراف مطلق صغير يمثّل نسبة كبيرة من الرحلة
// (مثلاً رحلة أساسية 2 كم مع انحراف 6 كم).
export const MAX_APPROXIMATE_DETOUR_RATIO = 0.25;

// إلى أي مدى يمكن أن يقع تقدّم B الموحّد على طول A->C خارج النطاق [0, 1]
// (كنسبة من طول القطعة نفسها) ويظل يُعتبر "بين A وC تقريبًا" — يمتص ضجيج
// GPS واستلامًا خارج الممر قليلاً بالقرب من البداية/النهاية، لكن ليس أبدًا
// بما يكفي لقبول استلام معكوس/للخلف بشكل حقيقي.
export const ROUTE_PROGRESS_TOLERANCE = 0.05;

// "هل D هي نفس مكان C فعليًا" — معبّر عنها بالكيلومترات لأن هذا الملف يعمل
// بالكيلومترات في كل مكان.
export const SAME_LOCATION_KM = 0.15;

// تحت هذا الطول لمسار A->C، يُعامل المسار الأساسي كنقطة واحدة (سائق تكون
// نقطة انطلاقه ووجهته في نفس المكان تقريبًا) بدلاً من اعتباره اتجاهًا —
// انظر projectOntoCorridor أدناه.
const MIN_CORRIDOR_LENGTH_KM = 0.01; // 10 أمتار

// ---------------------------------------------------------------------------
// نوع النتيجة (مُكيَّف مع اصطلاح المشروع الحالي وهو null بدلاً من undefined،
// مع سبب صريح — انظر نوع FeedItem الخاص بـ homeFeedLib.ts نفسه). لا يوجد
// حقل مدة (duration) في هذا الملف على الإطلاق: بدون خدمة توجيه طرق حقيقية،
// فإن تقدير الوقت سيكون "ملفّقًا" فقط، لذا يُنتَج فقط المسافة التقريبية
// (وهي بوضوح تقريب خط مستقيم، لا تُعرَض أبدًا كوقت وصول متوقع حقيقي).
// ---------------------------------------------------------------------------

export type RouteMatchReason =
  | "MATCH"
  | "NO_COORDINATES"
  | "TOO_FAR_FROM_ROUTE"
  | "WRONG_DIRECTION"
  | "DETOUR_TOO_LONG"
  | "DESTINATION_MISMATCH"
  | "NO_SEATS"
  | "EXPIRED";

export type RouteMatchResult = {
  tripId: string;
  eligible: boolean;
  pickupDistanceFromRouteKm: number | null;
  destinationDistanceFromRouteKm: number | null;
  // تقريب خط مستقيم للمسافة الإضافية التي سيقطعها السائق لخدمة هذا الراكب —
  // انظر calculateApproximateDetourKm أدناه. ليس أبدًا انحرافًا حقيقيًا
  // لشبكة الطرق؛ يُثبَّت دائمًا عند قيمة >= 0.
  approximateDetourKm: number | null;
  detourRatio: number | null;
  reason: RouteMatchReason;
};

// الشكل الأدنى، المستقل عن أي إطار عمل، الذي تحتاجه هذه الوحدة من رحلة
// السائق — homeFeedLib.ts تحوّل FeedItem الخاصة بها إلى هذا الشكل. كل من
// origin وdestination يكونان null لقائمة تسبق حفظ الإحداثيات (أو التي فشل
// حل إحداثياتها) — المستدعي (homeFeedLib.ts) يعود عندها إلى سلوك مسافة
// المنشأ البسيط الموجود مسبقًا، ولا يُنشئ أبدًا واحدًا من هذه بإحداثيات
// ناقصة.
export type DriverRouteInput = {
  tripId: string;
  origin: LatLng | null;
  destination: LatLng | null;
};

export type PassengerRouteQuery = {
  pickup: LatLng;
  // اختياري — انظر ترويسة هذا الملف. مُهمَل حاليًا من قِبل خلاصة "القريب
  // مني" في الصفحة الرئيسية (تُعامَل D على أنها نفس C)؛ يمكن لتدفق بحث
  // صريح مستقبلي أن يمرّر D حقيقية.
  destination?: LatLng | null;
};

// ---------------------------------------------------------------------------
// الهندسة — مسافة Haversine + إسقاط على مستوى محلي. لا خط متعرّج (polyline)
// مُفكَّك، لا حزمة هندسة خارجية: "المسار" الذي يعمل عليه هذا الملف هو دائمًا
// قطعة النقطتين A->C فقط، لذا فإن حساب المتجهات البسيط أبسط وأكثر شفافية من
// استيراد مكتبة هندسة خطوط لأجل قطعة واحدة.
// ---------------------------------------------------------------------------

// مسافة الخط المستقيم (Haversine، الدائرة العظمى) بالكيلومترات — المكان
// الوحيد الذي تمرّ منه كل مسافة بين نقطتين في هذا الملف. لم تُستورد عمدًا من
// calculateDistanceKm الخاصة بـ homeFeedLib.ts (نفس المعادلة تمامًا) — لأن
// ذلك سيجعل هذا الملف يعتمد على homeFeedLib.ts، التي تعتمد بدورها على هذا
// الملف، فيحدث استيراد دائري.
// الغرض: حساب المسافة الحقيقية بالكيلومترات بين نقطتين إحداثيات (خط عرض/طول).
function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * sinLng * sinLng;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(Math.min(1, h)));
}

// الغرض: التحقق هل نقطتان تُعتبران نفس المكان تقريبًا (المسافة بينهما ضمن SAME_LOCATION_KM).
export const isEffectivelySameLocation = (a: LatLng, b: LatLng): boolean =>
  haversineKm(a, b) <= SAME_LOCATION_KM;

// يحرس كل إحداثية تلمسها هذه الوحدة — يلتقط "المفقود" (null/undefined)
// و"غير الصالح" (NaN، خارج النطاق) في فحص واحد، لذا لا يحتاج المستدعون أبدًا
// لفحصين منفصلين.
// الغرض: التحقق من صحة نقطة إحداثيات — موجودة، والأرقام منطقية وضمن النطاق المسموح.
export function isValidLatLng(point: LatLng | null | undefined): point is LatLng {
  if (!point) return false;
  const { latitude, longitude } = point;
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

// الإحداثيات المقروءة من Firestore يجب أن تكون دائمًا أرقامًا، لكن بعض
// المستندات (أو باراميترات المسار، التي تصل كسلسلة نصية عبر
// useLocalSearchParams) قد تحمل سلسلة نصية رقمية بدلاً من ذلك — هذا هو
// المكان الوحيد الذي يحوّل بأمان أيًا من الشكلين إلى رقم حقيقي، أو null لأي
// شيء آخر (مفقود، سلسلة فارغة، نص غير رقمي). لا يرمي استثناءً أبدًا.
// الغرض: تحويل أي قيمة (رقم أو نص) إلى رقم إحداثية صالح، أو null إن تعذّر ذلك.
export function toFiniteCoordinate(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

// تقريب مستوٍ مسطّح صغير (equirectangular)، مُركَّز على origin — دقيق بما
// يكفي للمسافات القصيرة (الإقليمية، أقل بكثير من بضع مئات الكيلومترات) التي
// يتعامل معها هذا التطبيق؛ انظر ترويسة هذا الملف / ملاحظة "قيود الدقة" في
// التقرير النهائي لمعرفة لماذا هذه مفاضلة مقصودة وليست إغفالًا.
// الغرض: تحويل نقطة إحداثيات إلى إحداثيات مستوٍ مسطّح محلي (x, y) بالكيلومترات حول نقطة الأصل.
const toLocalPlaneKm = (origin: LatLng, point: LatLng): { x: number; y: number } => {
  const latRad = (origin.latitude * Math.PI) / 180;
  const kmPerDegLat = 110.574;
  const kmPerDegLng = 111.32 * Math.cos(latRad);
  return {
    x: (point.longitude - origin.longitude) * kmPerDegLng,
    y: (point.latitude - origin.latitude) * kmPerDegLat,
  };
};

export type CorridorProjection = {
  // المسافة العمودية من target إلى أقرب نقطة على قطعة A->C (مُثبَّتة عند
  // حدود القطعة نفسها، وليس الخط اللانهائي).
  distanceFromCorridorKm: number;
  // تقدّم target الموحّد على طول A->C: 0 = عند A، 1 = عند C، غير مُثبَّت
  // (UNCLAMPED) (لذا فإن قيمة مثل -0.2 أو 1.3 هي كيفية اكتشاف فحوصات
  // الاتجاه أدناه لـ "متأخر عن A بشكل كبير" / "متجاوز C بكثير").
  progress: number;
};

// يُسقط target على قطعة A->C المستقيمة. لا يرمي استثناءً أبدًا؛ قطعة A->C
// شبه معدومة الطول (سائق تكون نقطة انطلاقه ووجهته في نفس المكان تقريبًا)
// تعود إلى مسافة نقطة بسيطة من A، مع تقدّم 0 (لا يوجد اتجاه ذو معنى لتكون
// "متقدمًا" أو "متأخرًا" عليه).
// الغرض: إسقاط نقطة (target) على خط مسار السائق المستقيم A->C، وحساب بُعدها العمودي عنه ومدى تقدّمها على طوله.
export function projectOntoCorridor(
  origin: LatLng,
  destination: LatLng,
  target: LatLng,
): CorridorProjection {
  const destXY = toLocalPlaneKm(origin, destination);
  const targetXY = toLocalPlaneKm(origin, target);

  const corridorLengthSq = destXY.x * destXY.x + destXY.y * destXY.y;

  if (corridorLengthSq < MIN_CORRIDOR_LENGTH_KM * MIN_CORRIDOR_LENGTH_KM) {
    return { distanceFromCorridorKm: haversineKm(origin, target), progress: 0 };
  }

  const dot = targetXY.x * destXY.x + targetXY.y * destXY.y;
  const progress = dot / corridorLengthSq;

  const clamped = Math.max(0, Math.min(1, progress));
  const nearestX = destXY.x * clamped;
  const nearestY = destXY.y * clamped;
  const dx = targetXY.x - nearestX;
  const dy = targetXY.y - nearestY;

  return { distanceFromCorridorKm: Math.sqrt(dx * dx + dy * dy), progress };
}

// ---------------------------------------------------------------------------
// الفلترة المسبقة (Prefilter) — مسافة الممر (تعادل المرحلة 3) + التحقق من
// الاتجاه (تعادل المرحلة 4). فحوصات رخيصة، محلية، متزامنة — النوع الوحيد من
// الفحص الذي تقوم به هذه الوحدة، الآن بعد أن لم تعد هناك مرحلة 5 منفصلة
// قائمة على الشبكة؛ فحص الانحراف التقريبي أدناه مباشرة محلي بنفس القدر.
// ---------------------------------------------------------------------------

export type PrefilterResult = {
  passed: boolean;
  pickupDistanceFromRouteKm: number | null;
  destinationDistanceFromRouteKm: number | null;
  // "MATCH" هنا تعني فقط "اجتازت الفلترة المسبقة" — الأهلية النهائية لا
  // تزال تعتمد على فحص الانحراف التقريبي أدناه.
  reason: RouteMatchReason;
};

// الغرض: فلترة أولية سريعة لمرشّح سائق — التحقق هل نقطة استلام الراكب (ووجهته إن وُجدت)
// قريبتان بما يكفي من مسار السائق وبنفس اتجاهه، قبل الانتقال لحساب الانحراف الأدق.
export function prefilterCandidate(
  driverRoute: DriverRouteInput,
  query: PassengerRouteQuery,
): PrefilterResult {
  if (
    !isValidLatLng(driverRoute.origin) ||
    !isValidLatLng(driverRoute.destination) ||
    !isValidLatLng(query.pickup)
  ) {
    return {
      passed: false,
      pickupDistanceFromRouteKm: null,
      destinationDistanceFromRouteKm: null,
      reason: "NO_COORDINATES",
    };
  }

  const pickupProjection = projectOntoCorridor(
    driverRoute.origin,
    driverRoute.destination,
    query.pickup,
  );

  if (pickupProjection.distanceFromCorridorKm > MAX_ROUTE_CORRIDOR_DISTANCE_KM) {
    return {
      passed: false,
      pickupDistanceFromRouteKm: pickupProjection.distanceFromCorridorKm,
      destinationDistanceFromRouteKm: null,
      reason: "TOO_FAR_FROM_ROUTE",
    };
  }

  // يجب أن تقع B تقريبًا بين A وC — تُرفض إذا كانت خلف A بشكل كبير (تقدّم
  // سالب) أو بعد C بكثير (تقدّم > 1)، كل ذلك بما يتجاوز
  // ROUTE_PROGRESS_TOLERANCE.
  if (
    pickupProjection.progress < -ROUTE_PROGRESS_TOLERANCE ||
    pickupProjection.progress > 1 + ROUTE_PROGRESS_TOLERANCE
  ) {
    return {
      passed: false,
      pickupDistanceFromRouteKm: pickupProjection.distanceFromCorridorKm,
      destinationDistanceFromRouteKm: null,
      reason: "WRONG_DIRECTION",
    };
  }

  // D تساوي C فعليًا (وجهة صريحة محذوفة، أو نفس المكان فعلاً) — يتم التحقق
  // مقابل وجهة السائق C نفسها بدلاً من إضافة فحص زائد يمر دائمًا.
  const destinationTarget =
    query.destination && !isEffectivelySameLocation(query.destination, driverRoute.destination)
      ? query.destination
      : driverRoute.destination;

  if (!isValidLatLng(destinationTarget)) {
    return {
      passed: false,
      pickupDistanceFromRouteKm: pickupProjection.distanceFromCorridorKm,
      destinationDistanceFromRouteKm: null,
      reason: "NO_COORDINATES",
    };
  }

  const destinationProjection = projectOntoCorridor(
    driverRoute.origin,
    driverRoute.destination,
    destinationTarget,
  );

  if (destinationProjection.distanceFromCorridorKm > MAX_ROUTE_CORRIDOR_DISTANCE_KM) {
    return {
      passed: false,
      pickupDistanceFromRouteKm: pickupProjection.distanceFromCorridorKm,
      destinationDistanceFromRouteKm: destinationProjection.distanceFromCorridorKm,
      reason: "DESTINATION_MISMATCH",
    };
  }

  // يجب أن تأتي نقطة الاستلام قبل الوجهة على طول الممر — لا تتطلب أبدًا من
  // السائق السفر للخلف للوصول إلى B بعد أن يكون قد تجاوز موقع D بالفعل.
  if (pickupProjection.progress > destinationProjection.progress + ROUTE_PROGRESS_TOLERANCE) {
    return {
      passed: false,
      pickupDistanceFromRouteKm: pickupProjection.distanceFromCorridorKm,
      destinationDistanceFromRouteKm: destinationProjection.distanceFromCorridorKm,
      reason: "WRONG_DIRECTION",
    };
  }

  return {
    passed: true,
    pickupDistanceFromRouteKm: pickupProjection.distanceFromCorridorKm,
    destinationDistanceFromRouteKm: destinationProjection.distanceFromCorridorKm,
    reason: "MATCH",
  };
}

// ---------------------------------------------------------------------------
// الانحراف التقريبي — حساب خط مستقيم صافٍ، بدون أي اتصال شبكة. يتعامل بأمان
// مع القيم صفر/المفقودة/غير الصالحة/NaN/السالبة، لا يرمي استثناءً أبدًا، ولا
// يسمح أبدًا لرقم سيئ بالمرور بصمت كـ "مؤهّل".
// ---------------------------------------------------------------------------

// distance(A,B) + distance(B,C) - distance(A,C)، أو صيغة A->B->D->C عندما
// تُعطى passengerDestination (D) وتختلف عن C. مُثبَّتة عند >= 0 — قد ينتج عن
// أخطاء تقريب الفاصلة العائمة قيمة سالبة صغيرة جدًا لنقطة استلام تقع فعليًا
// بالضبط على خط A->C.
// الغرض: حساب المسافة الإضافية التقريبية (بالكيلومترات) التي سيقطعها السائق بسبب استلام/إنزال الراكب.
export function calculateApproximateDetourKm(
  origin: LatLng,
  pickup: LatLng,
  destination: LatLng,
  passengerDestination: LatLng | null,
): number {
  const baseKm = haversineKm(origin, destination);

  const withPickupKm = passengerDestination
    ? haversineKm(origin, pickup) +
      haversineKm(pickup, passengerDestination) +
      haversineKm(passengerDestination, destination)
    : haversineKm(origin, pickup) + haversineKm(pickup, destination);

  return Math.max(0, withPickupKm - baseKm);
}

export type ApproximateDetourInput = {
  baseDistanceKm: number;
  detourKm: number;
};

export type ApproximateDetourEvaluation = {
  passed: boolean;
  detourRatio: number | null;
};

// الغرض: التحقق هل الانحراف المحسوب ضمن الحدود المسموحة (المطلقة بالكيلومترات، والنسبية من مسافة الرحلة).
export function evaluateApproximateDetour(
  input: ApproximateDetourInput,
): ApproximateDetourEvaluation {
  const detourKm = Number(input?.detourKm);
  const baseDistanceKm = Number(input?.baseDistanceKm);

  if (!Number.isFinite(detourKm) || detourKm < 0) {
    return { passed: false, detourRatio: null };
  }

  const detourRatio =
    Number.isFinite(baseDistanceKm) && baseDistanceKm > 0 ? detourKm / baseDistanceKm : null;

  if (detourKm > MAX_APPROXIMATE_DETOUR_KM) return { passed: false, detourRatio };
  if (detourRatio !== null && detourRatio > MAX_APPROXIMATE_DETOUR_RATIO) {
    return { passed: false, detourRatio };
  }

  return { passed: true, detourRatio };
}

// ---------------------------------------------------------------------------
// الترتيب — أقل انحراف تقريبي، ثم أقل مسافة استلام عن الممر، ثم أقرب موعد
// انطلاق، ثم التقييم الحالي، ثم فاصل حتمي كامل بواسطة المعرّف. القيمة
// المفقودة/الفارغة تُرتَّب دائمًا في النهاية ضمن معيارها الخاص (لا تُعامَل
// أبدًا كـ "0 = الأفضل").
// ---------------------------------------------------------------------------

export type SortableRouteMatch = {
  tripId: string;
  approximateDetourKm: number | null;
  pickupDistanceFromRouteKm: number | null;
  departureTimestampMs: number;
  ratingAverage: number;
  id: string;
};

// الغرض: ترتيب قائمة نتائج المطابقة من الأفضل للأسوأ (أقل انحراف، ثم أقل بُعد استلام، ثم أقرب موعد، ثم أعلى تقييم).
export function sortRouteMatches<T extends SortableRouteMatch>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aDetour = a.approximateDetourKm ?? Number.POSITIVE_INFINITY;
    const bDetour = b.approximateDetourKm ?? Number.POSITIVE_INFINITY;
    if (aDetour !== bDetour) return aDetour - bDetour;

    const aPickup = a.pickupDistanceFromRouteKm ?? Number.POSITIVE_INFINITY;
    const bPickup = b.pickupDistanceFromRouteKm ?? Number.POSITIVE_INFINITY;
    if (aPickup !== bPickup) return aPickup - bPickup;

    if (a.departureTimestampMs !== b.departureTimestampMs) {
      return a.departureTimestampMs - b.departureTimestampMs;
    }

    if (a.ratingAverage !== b.ratingAverage) {
      return b.ratingAverage - a.ratingAverage; // الأعلى تقييمًا أولاً
    }

    return a.id.localeCompare(b.id);
  });
}

// ---------------------------------------------------------------------------
// التنسيق — الفلترة المسبقة، ثم (فقط للمرشّحين الذين اجتازوها) فحص الانحراف
// التقريبي. متزامن بالكامل: لا شبكة، لا تخزين مؤقت، لا محدّد تزامن، لا
// AbortController — لا يوجد شيء غير متزامن متبقٍ ليُخزَّن مؤقتًا أو يُحدَّد
// أو يُلغى. هذه هي الدالة الوحيدة التي تستدعيها homeFeedLib.ts؛ لا تلمس
// أبدًا Firestore أو حالة React بنفسها.
// ---------------------------------------------------------------------------

// الغرض: الدالة الرئيسية للملف — تفلتر وتقيّم كل السائقين المرشّحين مقابل طلب الراكب، وترجع نتيجة مطابقة (مؤهّل أم لا، مع السبب) لكل واحد منهم.
export function getRouteMatchesForCandidates(
  candidates: DriverRouteInput[],
  query: PassengerRouteQuery,
): RouteMatchResult[] {
  return candidates.map((driverRoute): RouteMatchResult => {
    const prefilter = prefilterCandidate(driverRoute, query);

    if (!prefilter.passed) {
      return {
        tripId: driverRoute.tripId,
        eligible: false,
        pickupDistanceFromRouteKm: prefilter.pickupDistanceFromRouteKm,
        destinationDistanceFromRouteKm: prefilter.destinationDistanceFromRouteKm,
        approximateDetourKm: null,
        detourRatio: null,
        reason: prefilter.reason,
      };
    }

    // prefilterCandidate تُرجع passed: true فقط عندما تكون origin/
    // destination/pickup (وإن وُجدت destinationTarget) كلها قيم LatLng
    // صالحة — من الآمن التأكيد على أنها غير null هنا.
    const origin = driverRoute.origin!;
    const destination = driverRoute.destination!;

    const passengerDestination =
      query.destination && !isEffectivelySameLocation(query.destination, destination)
        ? query.destination
        : null;

    const baseDistanceKm = haversineKm(origin, destination);
    const detourKm = calculateApproximateDetourKm(
      origin,
      query.pickup,
      destination,
      passengerDestination,
    );
    const detour = evaluateApproximateDetour({ baseDistanceKm, detourKm });

    return {
      tripId: driverRoute.tripId,
      eligible: detour.passed,
      pickupDistanceFromRouteKm: prefilter.pickupDistanceFromRouteKm,
      destinationDistanceFromRouteKm: prefilter.destinationDistanceFromRouteKm,
      approximateDetourKm: detourKm,
      detourRatio: detour.detourRatio,
      reason: detour.passed ? "MATCH" : "DETOUR_TOO_LONG",
    };
  });
}
