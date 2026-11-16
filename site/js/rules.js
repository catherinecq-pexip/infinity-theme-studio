// Theme rules for Pexip Infinity "new style" (version 2) themes.
//
// Everything in this module is transcribed from Pexip's public documentation:
//   https://docs.pexip.com/admin/themes_file_requirements.htm
//   https://docs.pexip.com/admin/themes_creating_editing.htm
//
// Target platform version: Pexip Infinity v42. When Pexip adds or changes theme
// settings in a new release, update this file first (see docs/updating-rules.md).

export const TARGET_INFINITY_VERSION = "42";

export const THEMECONFIG = "themeconfig.json";
export const VENDORDATA = "vendordata.json";

// ---------------------------------------------------------------------------
// themeconfig.json — known top-level settings
// ---------------------------------------------------------------------------

/** Boolean settings (Base theme + "Additional settings" table). */
export const BOOLEAN_SETTINGS = new Set([
  "enable_dtmf_conference_control",
  "enable_avatars_in_mix",
  "disable_ai_indicator",
  "disable_external_media_proc_indicator",
  "disable_streaming_indicator",
  "disable_recording_indicator",
  "disable_transcribing_indicator",
  "disable_smart_notes_indicator",
  "disable_watermark_icon",
  "disable_watermark_mute_icon",
  "disable_conference_locked_indicator",
  "disable_multiscreen",
  "enable_solo_streaming_loopback",
  "disable_comfort_noise",
]);

/** Free-text settings. */
export const TEXT_SETTINGS = new Set([
  "ai_indicator_text",
  "external_media_proc_indicator_text",
  "streaming_indicator_text",
  "public_streaming_indicator_text",
  "recording_indicator_text",
  "transcribing_indicator_text",
  "smart_notes_indicator_text",
  "live_captions_on_indicator_text",
  "live_captions_off_indicator_text",
  "conference_locked_indicator_text",
  "conference_unlocked_indicator_text",
  "conference_locked_indicator_n_waiting_text",
  "reserved_slot_overlay_text",
]);

/** Numeric settings. */
export const NUMBER_SETTINGS = new Set([
  "test_call_service_media_delay",
  "test_call_service_disconnect_timeout",
  "breakout_transfer_delay",
]);

/** Colour settings at top level. */
export const COLOR_SETTINGS = new Set([
  "text_color",
  "avatar_in_mix_text_color",
  "avatar_in_mix_shape_color",
]);

/** Structured settings (validated individually). */
export const STRUCTURED_SETTINGS = new Set([
  "theme_version",
  "dtmf_conference_control_commands",
  "dtmf_allowed_layouts",
  "message_box_config",
  "indicator_color_config",
  "clock_data",
  "classification",
  "splash_screens",
]);

export const KNOWN_TOP_LEVEL = new Set([
  ...BOOLEAN_SETTINGS, ...TEXT_SETTINGS, ...NUMBER_SETTINGS, ...COLOR_SETTINGS, ...STRUCTURED_SETTINGS,
]);

/** Settings with a documented maximum length. */
export const MAX_TEXT_LENGTH = {
  conference_locked_indicator_text: 20,
};

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

/** RGB (0xRRGGBB) or ARGB (0xAARRGGBB) hexadecimal notation. */
export const COLOR_RE = /^0x([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// Avatar colours are documented with a leading "#" in the Pexip docs, so both
// "#..." and "0x..." forms are accepted for those two settings.
export const AVATAR_COLOR_RE = /^(0x|#)([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export const MESSAGE_BOX_COLOR_KEYS = new Set(["text_color", "background_color", "border_color"]);

export const INDICATOR_TYPES = new Set([
  "ai",
  "captions",
  "external_media_proc",
  "gms_smart_notes",
  "hand_raised",
  "locked",
  "recording",
  "speaker",
  "streaming",
  "transcribing",
]);
export const INDICATOR_COLOR_KEYS = new Set(["background", "border", "text"]);

// ---------------------------------------------------------------------------
// DTMF
// ---------------------------------------------------------------------------

export const DTMF_COMMANDS = new Set([
  "toggle_self_mute",
  "toggle_lock",
  "toggle_guest_mute",
  "toggle_pres_in_mix",
  "toggle_multiscreen",
  "cycle_layout",
  "toggle_raise_hand",
  "cycle_personal_layout",
  "end_conference",
  "toggle_teams_large_gallery",
]);
export const DTMF_KEY_RE = /^[0-9*#]{2}$/;

/** Built-in layout identifiers usable in dtmf_allowed_layouts. */
export const BUILTIN_LAYOUTS = new Set([
  "1:7", "ac", "1:21", "2:21", "2x2", "3x3", "4x4", "5x5", "1:0", "1:33",
  "one_main_twelve_around", "two_mains_eight_around", "one_main_nine_around",
]);

// ---------------------------------------------------------------------------
// Clock / timer (new in v42)
// ---------------------------------------------------------------------------

export const CLOCK_TYPES = new Set(["elapsed", "remaining", "time"]);
export const CLOCK_DATE_FORMATS = new Set(["dd/mm/yyyy", "mm/dd/yyyy"]);
export const CLOCK_STARTING_VALUE_RANGE = [1, 31_536_000];

// ---------------------------------------------------------------------------
// Splash screens
// ---------------------------------------------------------------------------

export const SPLASH_SCREENS = new Set([
  "welcome", "connecting", "waiting_for_host", "inlobby", "inlobby_status_unknown",
  "other_participants_audio_only", "pin_welcome", "pin_entry", "pin_correct", "pin_invalid",
  "timeout", "no_incoming_video", "no_main_video", "no_presentation",
  "stream_waiting", "streaming_in_progress",
  "test_call_welcome", "test_call_in_progress", "test_call_complete",
  "virtual_reception_welcome", "virtual_reception_conference_id_entry",
  "virtual_reception_conference_id_invalid", "virtual_reception_connecting",
  "error_capacity_exceeded", "error_insufficient_licenses",
  "error_insufficient_video_licenses", "error_invalid_license",
  "direct_media_welcome", "direct_media_waiting_for_host", "direct_media_host_left",
  "direct_media_other_participants_audio_only", "direct_media_escalate",
  "direct_media_deescalate",
  "unused_screen", "reserved_slot",
]);

/** Default label keys (custom labels may also be added to the labels object). */
export const DEFAULT_LABELS = new Set([
  "welcome", "connecting", "waiting_for_host", "inlobby", "inlobby_status_unknown",
  "other_participants_audio_only", "please_enter_pin", "pin_correct", "invalid_pin",
  "timeout", "no_presentation", "stream_waiting", "streaming_in_progress",
  "test_call_welcome_header", "test_call_welcome_text", "test_call_in_progress",
  "test_call_complete", "enter_conference_id", "conference_id_entry",
  "conference_id_invalid", "virtual_reception_connecting", "capacity_exceeded",
  "insufficient_licenses", "insufficient_video_licenses", "invalid_license",
  "host_left", "direct_media_escalate", "direct_media_deescalate",
]);

export const LAYOUT_TYPES = new Set(["vertical", "free_form"]);
export const ELEMENT_TYPES = new Set(["icon", "text", "pin_digits"]);
export const TEXT_ALIGN = new Set(["center", "left", "right"]);
export const FONTS = new Set([
  "Noto Sans", "Roboto", "Roboto Condensed", "GT Pressura", "GT Pressura Light",
  "Inter", "Inter Medium",
]);
export const ICON_PATH_RE = /^icon_[A-Za-z0-9_]+\.svg$/;
export const BACKGROUND_PATH_RE = /^background[A-Za-z0-9_]*\.jpg$/;

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export const BACKGROUND_SIZE = [1920, 1080];
export const WATERMARK_SIZE = [200, 100];
export const WATERMARK_FILES = new Set(["watermark_icon.png", "watermark_footer_icon.png"]);
export const MUTE_WATERMARK_FILE = "watermark_mute_icon.png";

/** Base theme SVG files (may be replaced by a file of the same name). */
export const BASE_SVG_FILES = new Set([
  "icon_active_page.svg", "icon_inactive_page.svg", "icon_connecting.svg", "icon_error.svg",
  "icon_error_insufficient_video_licenses.svg", "icon_is_in_lobby.svg",
  "icon_no_presentation.svg", "icon_no_video.svg", "icon_other_participants_audio_only.svg",
  "icon_pin_entry.svg", "icon_pin_entry_digit.svg", "icon_pin_invalid.svg",
  "icon_reserved_slot.svg", "icon_streaming_screen.svg", "icon_test_call_complete.svg",
  "icon_test_call_welcome.svg", "icon_timeout.svg", "icon_unused_screen.svg",
  "icon_virtual_reception_conference_id_entry.svg",
  "icon_virtual_reception_conference_id_invalid.svg",
  "icon_virtual_reception_connecting.svg", "icon_virtual_reception_welcome.svg",
  "icon_waiting_for_host.svg", "icon_welcome.svg",
]);

export const BASE_BACKGROUNDS = new Set([
  "background.jpg", "background_test_call.jpg", "background_reserved_slot.jpg",
]);

/** Audio requirements: WAV, PCM 16-bit, mono, 48 kHz. */
export const AUDIO_CHANNELS = 1;
export const AUDIO_SAMPLE_WIDTH_BYTES = 2;
export const AUDIO_SAMPLE_RATE = 48_000;

/** Base theme audio file names (replacements must use the same name). */
export const BASE_AUDIO_FILES = new Set([
  "2sd-invalid-number-three-times-disconnect_48kHz_mono.wav",
  "2sd-not-entered-valid-number-disconnect-call_48kHz_mono.wav",
  "2sd-number-not-valid-try-again_48kHz_mono.wav",
  "2sd-number-pound-key_48kHz_mono.wav",
  "2sd-please-hold-connect-you_48kHz_mono.wav",
  "call_about_to_be_transferred.wav",
  "call_about_to_transfer_to_main_room.wav",
  "conf-ai_started_48kHz_mono.wav",
  "conf-ai_stopped_48kHz_mono.wav",
  "conf-call-will-be-disconnected_48kHz_mono.wav",
  "conf-capacity_exceeded_48kHz_mono.wav",
  "conf-classification-changed_48kHz_mono.wav",
  "conf-external-media-processing-start_48kHz_mono.wav",
  "conf-external-media-processing-stopped_48kHz_mono.wav",
  "conf-getpin_48kHz_mono.wav",
  "conf-getpin_pound-key_48kHz_mono.wav",
  "conf-insufficient_licenses_48kHz_mono.wav",
  "conf-invalid_license_48kHz_mono.wav",
  "conf-invalidpin_48kHz_mono.wav",
  "conf-leaderhasleft_48kHz_mono.wav",
  "conf-live_captions_started_48kHz_mono.wav",
  "conf-live_captions_stopped_48kHz_mono.wav",
  "conf-participant_entry_tone_48kHz_mono.wav",
  "conf-participant_exit_tone_48kHz_mono.wav",
  "conf-participant_is_in_lobby_48kHz_mono.wav",
  "conf-participant_locked_out_48Khz_mono.wav",
  "conf-placeintoconf_48kHz_mono.wav",
  "conf-public_streaming_started_48kHz_mono.wav",
  "conf-public_streaming_stopped_48kHz_mono.wav",
  "conf-recording_started_48kHz_mono.wav",
  "conf-recording_stopped_48kHz_mono.wav",
  "conf-smart_notes_started_48kHz_mono.wav",
  "conf-smart_notes_stopped_48kHz_mono.wav",
  "conf-streaming_started_48kHz_mono.wav",
  "conf-streaming_stopped_48kHz_mono.wav",
  "conf-test_call_48kHz_mono.wav",
  "conf-test_call_audio_only_48kHz_mono.wav",
  "conf-test_call_disconnect_48kHz_mono.wav",
  "conf-transcribing_started_48kHz_mono.wav",
  "conf-transcribing_stopped_48kHz_mono.wav",
  "conf-waitforleader_48kHz_mono.wav",
  "conf-waithostpin_48kHz_mono.wav",
  "conf-waithostpin_pound-key_48kHz_mono.wav",
  "conf-you_are_the_only_participant_48kHz_mono.wav",
]);

/** Custom layouts. */
export const CUSTOM_LAYOUT_PREFIX = "custom_layout_";
export const CUSTOM_LAYOUT_NAME_RE = /^[A-Za-z0-9_]{1,50}$/;
export const CUSTOM_LAYOUT_MAX_SLOTS = 26;
export const CUSTOM_LAYOUT_MAX_GRID = 10;

// ---------------------------------------------------------------------------
// Infinity versions
// ---------------------------------------------------------------------------

export const LATEST_VERSION = Number(TARGET_INFINITY_VERSION);

/** Versions offered in the portal's version picker (38 means "38 or older"). */
export const SUPPORTED_VERSIONS = [42, 41, 40, 39, 38];

/**
 * First Infinity version that accepts each item. Anything not listed works on
 * every version the portal supports. Derived from Pexip's versioned theme docs
 * (docs.pexip.com/v36 … v42) plus what real systems accept:
 * - indicator colours external_media_proc / gms_smart_notes appear in the v41
 *   and v42 docs, but both v41 and v42 systems rejected
 *   indicator_color_config.external_media_proc ("Unsupported field"). Infinity
 *   stops at the first bad key (alphabetical: ai and captions passed), so
 *   gms_smart_notes, listed in the docs alongside it, is untested and treated
 *   the same way. Both are NEVER until a real system accepts them.
 */
export const NEVER = Infinity;

export const MIN_VERSION = {
  setting: {
    disable_external_media_proc_indicator: 39,
    external_media_proc_indicator_text: 39,
    enable_avatars_in_mix: 40,
    avatar_in_mix_text_color: 40,
    avatar_in_mix_shape_color: 40,
    disable_recording_indicator: 41,
    disable_transcribing_indicator: 41,
    disable_smart_notes_indicator: 41,
    smart_notes_indicator_text: 41,
    breakout_transfer_delay: 42,
    clock_data: 42,
  },
  indicator: {
    external_media_proc: NEVER,
    gms_smart_notes: NEVER,
  },
  audio: {
    "conf-external-media-processing-start_48kHz_mono.wav": 39,
    "conf-external-media-processing-stopped_48kHz_mono.wav": 39,
    "conf-classification-changed_48kHz_mono.wav": 41,
    "conf-smart_notes_started_48kHz_mono.wav": 41,
    "conf-smart_notes_stopped_48kHz_mono.wav": 41,
    "call_about_to_be_transferred.wav": 42,
    "call_about_to_transfer_to_main_room.wav": 42,
  },
  dtmf: {
    cycle_personal_layout: 38,
  },
};

/** First version supporting an item (0 = all versions). kind: setting | indicator | audio | dtmf */
export function minVersion(kind, name) {
  return MIN_VERSION[kind]?.[name] ?? 0;
}

export function supports(version, kind, name) {
  return minVersion(kind, name) <= version;
}

/** Human-readable requirement, e.g. "needs Infinity v42" or "isn't accepted by Infinity". */
export function requirement(kind, name) {
  const v = minVersion(kind, name);
  return v === NEVER ? "isn't accepted by Infinity" : `needs Infinity v${v}`;
}
