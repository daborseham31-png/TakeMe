// ---------------------------------------------------------------------------
// Cross-platform date/time picker barrel — screens that render
// @react-native-community/datetimepicker import it from here instead, so
// Metro can swap in PlatformDateTimePicker.web.tsx on Web (that package ships
// zero web support, same situation as react-native-maps — see
// PlatformMapView.tsx for the full rationale, including why this pair lives
// outside app/).
//
// Native: trivial re-export, zero behavior change.
// ---------------------------------------------------------------------------

import DateTimePicker from "@react-native-community/datetimepicker";

export default DateTimePicker;
