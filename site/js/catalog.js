// Human-friendly descriptions for everything the portal can customise.
//
// rules.js says what is *valid*; this file says how to *present* it. A test
// (tests/catalog.test.js) checks that every setting in rules.js appears here.

export const DOCS = {
  rules: "https://docs.pexip.com/admin/themes_file_requirements.htm",
  creating: "https://docs.pexip.com/admin/themes_creating_editing.htm",
  layoutDesigner: "https://cdn.pexip.com/layout/",
  brandingPortal: "https://branding.pexip.io/brand",
  notchIcons: "https://docs.pexip.com/admin/themes_file_requirements.htm",
};

/** Built-in experience profiles (files in site/profiles/). */
export const PROFILE_NAMES = ["standard", "secure", "event", "client", "reception"];

// ---------------------------------------------------------------------------
// In-call indicators
// ---------------------------------------------------------------------------

export const INDICATORS = [
  {
    id: "recording", notch: ["recording"], title: "Recording", color: "recording", hide: "disable_recording_indicator",
    help: "Shown to everyone while the meeting is being recorded.",
    texts: [{ key: "recording_indicator_text", label: "Indicator text" }],
  },
  {
    id: "streaming", notch: ["streaming", "public_streaming"], title: "Streaming", color: "streaming", hide: "disable_streaming_indicator",
    help: "Shown while the meeting is being streamed.",
    texts: [
      { key: "streaming_indicator_text", label: "Streaming text" },
      { key: "public_streaming_indicator_text", label: "Public streaming text" },
    ],
  },
  {
    id: "transcribing", notch: ["transcribing"], title: "Transcribing", color: "transcribing", hide: "disable_transcribing_indicator",
    help: "Shown while the meeting is being transcribed.",
    texts: [{ key: "transcribing_indicator_text", label: "Indicator text" }],
  },
  {
    id: "captions", notch: ["live_captions"], title: "Live captions", color: "captions", hide: null,
    help: "Shown when live captions are switched on or off.",
    texts: [
      { key: "live_captions_on_indicator_text", label: "Captions on text" },
      { key: "live_captions_off_indicator_text", label: "Captions off text" },
    ],
  },
  {
    id: "ai", notch: ["ai"], title: "AI", color: "ai", hide: "disable_ai_indicator",
    help: "Shown while AI services are active in the meeting.",
    texts: [{ key: "ai_indicator_text", label: "Indicator text" }],
  },
  {
    id: "smart_notes", notch: ["smart_notes"], title: "Smart notes", color: "gms_smart_notes", hide: "disable_smart_notes_indicator",
    help: "Shown while smart notes are being taken.",
    texts: [{ key: "smart_notes_indicator_text", label: "Indicator text" }],
  },
  {
    id: "external_media_proc", notch: ["external_media_proc"], title: "External media processing", color: "external_media_proc",
    hide: "disable_external_media_proc_indicator",
    help: "Shown while meeting media is sent to an external processing service.",
    texts: [{ key: "external_media_proc_indicator_text", label: "Indicator text" }],
  },
  {
    id: "locked", notch: ["conference_locked", "conference_unlocked"], title: "Meeting locked", color: "locked", hide: "disable_conference_locked_indicator",
    help: "Shown when the meeting is locked or unlocked, and when people are waiting to be let in.",
    texts: [
      { key: "conference_locked_indicator_text", label: "Locked text", max: 20 },
      { key: "conference_unlocked_indicator_text", label: "Unlocked text" },
      { key: "conference_locked_indicator_n_waiting_text", label: "People waiting text",
        help: "{number_of_waiting_participants} is replaced with the number of people waiting." },
    ],
  },
  {
    id: "hand_raised", notch: ["raised_hand"], title: "Raised hand", color: "hand_raised", hide: null,
    help: "Shown when a participant raises their hand.", texts: [],
  },
  {
    id: "speaker", notch: [], title: "Active speaker", color: "speaker", hide: null,
    help: "Highlights the person currently speaking.", texts: [],
  },
];

// ---------------------------------------------------------------------------
// General settings, grouped into sections
// ---------------------------------------------------------------------------

export const GENERAL_SECTIONS = [
  {
    id: "branding", title: "Watermarks & text",
    help: "The logo shown on the main speaker video, the overlay shown to muted participants, and the default text colour. Upload the images themselves in the Images step.",
    fields: [
      { key: "disable_watermark_icon", type: "bool", label: "Hide the watermark logo" },
      { key: "disable_watermark_mute_icon", type: "bool", label: "Hide the muted overlay",
        help: "An overlay shown under the indicators to participants who have been muted by an administrator. Infinity hides it by default." },
      { key: "text_color", type: "color", label: "Default text colour" },
    ],
  },
  {
    id: "avatars", title: "Participant avatars",
    help: "Show an avatar in the video layout for people who join audio-only or with their camera off.",
    fields: [
      { key: "enable_avatars_in_mix", type: "bool", label: "Show avatars in the video layout" },
      { key: "avatar_in_mix_text_color", type: "color", label: "Avatar text colour" },
      { key: "avatar_in_mix_shape_color", type: "color", label: "Avatar shape colour" },
    ],
  },
  {
    id: "media", title: "Room systems, layouts & media",
    help: "Behaviour for room systems and the video layout.",
    fields: [
      { key: "disable_multiscreen", type: "bool", label: "Disable multiscreen",
        help: "Multiscreen lets room systems with more than one display show extra participants." },
      { key: "disable_comfort_noise", type: "bool", label: "Disable comfort noise" },
      { key: "no_main_video_bg", type: "color", label: "Background colour when there's no main video",
        help: "Found in Pexip's language themes (e.g. English US); not in the theme docs." },
      { key: "enable_solo_streaming_loopback", type: "bool", label: "Enable solo streaming loopback" },
      { key: "reserved_slot_overlay_text", type: "text", label: "Reserved slot overlay text",
        help: "Text shown on a layout slot that is reserved for a participant who hasn't joined yet." },
    ],
  },
  {
    id: "timing", title: "Test calls & breakout rooms",
    help: "Timing values. See Pexip's theme documentation for units and defaults.",
    fields: [
      { key: "test_call_service_media_delay", type: "number", label: "Test call media delay" },
      { key: "test_call_service_disconnect_timeout", type: "number", label: "Test call disconnect timeout" },
      { key: "breakout_transfer_delay", type: "number", label: "Breakout room transfer delay" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Keypad (DTMF)
// ---------------------------------------------------------------------------

export const DTMF_COMMAND_LABELS = {
  toggle_self_mute: "Mute / unmute myself",
  toggle_raise_hand: "Raise / lower my hand",
  cycle_personal_layout: "Change my own layout",
  cycle_layout: "Change the layout for everyone",
  toggle_lock: "Lock / unlock the meeting",
  toggle_guest_mute: "Mute / unmute all guests",
  toggle_pres_in_mix: "Show the presentation in the main video",
  toggle_multiscreen: "Turn multiscreen on / off",
  toggle_teams_large_gallery: "Teams large gallery on / off",
  end_conference: "End the meeting for everyone",
};

export const LAYOUT_LABELS = {
  ac: "Adaptive Composition",
  "1:0": "Speaker only",
  "1:7": "1 main speaker + 7 small",
  "1:21": "1 main speaker + 21 small",
  "2:21": "2 main speakers + 21 small",
  "1:33": "1 main speaker + 33 small",
  "2x2": "Equal 2×2 grid",
  "3x3": "Equal 3×3 grid",
  "4x4": "Equal 4×4 grid",
  "5x5": "Equal 5×5 grid",
  one_main_nine_around: "1 main, 9 around",
  one_main_twelve_around: "1 main, 12 around",
  two_mains_eight_around: "2 main, 8 around",
};

// ---------------------------------------------------------------------------
// Splash screen wording
// ---------------------------------------------------------------------------

export const LABEL_GROUPS = [
  { title: "Joining", labels: {
    welcome: "Welcome screen",
    connecting: "Connecting",
    please_enter_pin: "Asking for the PIN",
    pin_correct: "PIN accepted",
    invalid_pin: "Wrong PIN",
    timeout: "Timed out (no PIN entered)",
  } },
  { title: "Waiting", labels: {
    waiting_for_host: "Waiting for the host",
    inlobby: "Waiting in the lobby",
    inlobby_status_unknown: "Lobby status unknown",
    host_left: "Host has left",
    other_participants_audio_only: "Everyone else is audio-only",
    no_presentation: "No presentation",
  } },
  { title: "Streaming", labels: {
    stream_waiting: "Stream waiting to start",
    streaming_in_progress: "Streaming in progress",
  } },
  { title: "Virtual Reception", labels: {
    enter_conference_id: "Enter meeting number",
    conference_id_entry: "Meeting number being entered",
    conference_id_invalid: "Invalid meeting number",
    virtual_reception_connecting: "Connecting to the meeting",
  } },
  { title: "Test call", labels: {
    test_call_welcome_header: "Test call welcome (heading)",
    test_call_welcome_text: "Test call welcome (text)",
    test_call_in_progress: "Test call in progress",
    test_call_complete: "Test call complete",
  } },
  { title: "Direct media", labels: {
    direct_media_escalate: "Moving to a bigger meeting",
    direct_media_deescalate: "Moving back to a direct call",
  } },
  { title: "Errors & licensing", labels: {
    capacity_exceeded: "Capacity exceeded",
    insufficient_licenses: "Not enough licenses",
    insufficient_video_licenses: "Not enough video licenses",
    invalid_license: "Invalid license",
  } },
];

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export const IMAGE_SLOTS = [
  { file: "watermark_icon.png", title: "Watermark logo", spec: "PNG, 200×100",
    help: "Your logo, shown in the corner of the video.", fit: { w: 200, h: 100, mode: "contain", type: "image/png" } },
  { file: "watermark_footer_icon.png", title: "Footer watermark", spec: "PNG, 200×100",
    help: "Only used in the 1 + 33 layout, at the bottom on a white background, so use inverted (dark) colours.", fit: { w: 200, h: 100, mode: "contain", type: "image/png" } },
  { file: "watermark_mute_icon.png", title: "Muted overlay", spec: "PNG, 200×100",
    help: "Shown under the indicators to a participant who has been muted by an administrator (switch it on in Settings → General). If it mentions a keypad code, keep it in sync with your keypad settings.",
    fit: { w: 200, h: 100, mode: "contain", type: "image/png" } },
  { file: "background.jpg", title: "Splash screen background", spec: "JPG (RGB), 1920×1080",
    help: "Behind every splash screen unless a screen sets its own.", fit: { w: 1920, h: 1080, mode: "cover", type: "image/jpeg" } },
  { file: "background_test_call.jpg", title: "Test call background", spec: "JPG (RGB), 1920×1080",
    help: "Behind the test call screens.", fit: { w: 1920, h: 1080, mode: "cover", type: "image/jpeg" } },
  { file: "background_reserved_slot.jpg", title: "Reserved slot background", spec: "JPG (RGB), 1920×1080",
    help: "Fills a layout slot reserved for someone who hasn't joined.", fit: { w: 1920, h: 1080, mode: "cover", type: "image/jpeg" } },
  { file: "background_avatar_in_mix.jpg", title: "Avatar background", spec: "JPG (RGB), 1920×1080 recommended",
    help: "Behind participant avatars when avatars are switched on.", fit: { w: 1920, h: 1080, mode: "cover", type: "image/jpeg" } },
];

// ---------------------------------------------------------------------------
// Voice prompts
// ---------------------------------------------------------------------------

export const AUDIO_GROUPS = [
  { title: "Joining & PIN", prompts: {
    "conf-getpin_48kHz_mono.wav": "Please enter the PIN",
    "conf-getpin_pound-key_48kHz_mono.wav": "Please enter the PIN, followed by the pound key",
    "conf-invalidpin_48kHz_mono.wav": "That PIN is not valid",
    "conf-waithostpin_48kHz_mono.wav": "Waiting for the host (guests can enter the host PIN)",
    "conf-waithostpin_pound-key_48kHz_mono.wav": "Waiting for the host (host PIN followed by pound key)",
    "conf-placeintoconf_48kHz_mono.wav": "You are now joining the meeting",
    "conf-you_are_the_only_participant_48kHz_mono.wav": "You are the only participant",
    "conf-participant_entry_tone_48kHz_mono.wav": "Tone: someone joined",
    "conf-participant_exit_tone_48kHz_mono.wav": "Tone: someone left",
  } },
  { title: "Waiting, lobby & leaving", prompts: {
    "conf-waitforleader_48kHz_mono.wav": "Waiting for the host to join",
    "conf-leaderhasleft_48kHz_mono.wav": "The host has left",
    "conf-participant_is_in_lobby_48kHz_mono.wav": "Someone is waiting in the lobby",
    "conf-participant_locked_out_48Khz_mono.wav": "The meeting is locked",
    "conf-call-will-be-disconnected_48kHz_mono.wav": "Your call will be disconnected",
  } },
  { title: "Recording, streaming & AI", prompts: {
    "conf-recording_started_48kHz_mono.wav": "Recording started",
    "conf-recording_stopped_48kHz_mono.wav": "Recording stopped",
    "conf-streaming_started_48kHz_mono.wav": "Streaming started",
    "conf-streaming_stopped_48kHz_mono.wav": "Streaming stopped",
    "conf-public_streaming_started_48kHz_mono.wav": "Public streaming started",
    "conf-public_streaming_stopped_48kHz_mono.wav": "Public streaming stopped",
    "conf-transcribing_started_48kHz_mono.wav": "Transcription started",
    "conf-transcribing_stopped_48kHz_mono.wav": "Transcription stopped",
    "conf-live_captions_started_48kHz_mono.wav": "Live captions started",
    "conf-live_captions_stopped_48kHz_mono.wav": "Live captions stopped",
    "conf-smart_notes_started_48kHz_mono.wav": "Smart notes started",
    "conf-smart_notes_stopped_48kHz_mono.wav": "Smart notes stopped",
    "conf-ai_started_48kHz_mono.wav": "AI started",
    "conf-ai_stopped_48kHz_mono.wav": "AI stopped",
    "conf-external-media-processing-start_48kHz_mono.wav": "External media processing started",
    "conf-external-media-processing-stopped_48kHz_mono.wav": "External media processing stopped",
    "conf-classification-changed_48kHz_mono.wav": "The classification level has changed",
  } },
  { title: "Virtual Reception", prompts: {
    "2sd-number-pound-key_48kHz_mono.wav": "Enter the meeting number, followed by the pound key",
    "2sd-number-not-valid-try-again_48kHz_mono.wav": "That number is not valid, please try again",
    "2sd-invalid-number-three-times-disconnect_48kHz_mono.wav": "Invalid number three times, disconnecting",
    "2sd-not-entered-valid-number-disconnect-call_48kHz_mono.wav": "No valid number entered, disconnecting",
    "2sd-please-hold-connect-you_48kHz_mono.wav": "Please hold while we connect you",
  } },
  { title: "Test call", prompts: {
    "conf-test_call_48kHz_mono.wav": "Test call introduction",
    "conf-test_call_audio_only_48kHz_mono.wav": "Test call introduction (audio-only)",
    "conf-test_call_disconnect_48kHz_mono.wav": "Test call ending",
  } },
  { title: "Transfers & breakout rooms", prompts: {
    "call_about_to_be_transferred.wav": "You are about to be transferred",
    "call_about_to_transfer_to_main_room.wav": "You are about to return to the main room",
  } },
  { title: "Capacity & licensing", prompts: {
    "conf-capacity_exceeded_48kHz_mono.wav": "The meeting is full",
    "conf-insufficient_licenses_48kHz_mono.wav": "Not enough licenses",
    "conf-invalid_license_48kHz_mono.wav": "Invalid license",
  } },
];

/** Capability overview shown on the Start step. */
export const CAPABILITIES = [
  ["Splash screens", "Backgrounds, logos and wording for every screen people see before and between meetings."],
  ["Watermarks", "Your logo on the main speaker video, a footer logo, and an overlay for muted participants."],
  ["In-call indicators", "Wording, colours and visibility for recording, streaming, captions, AI, lock and more."],
  ["Classification banner", "Internal / Confidential / Secret labels that hosts can change mid-meeting."],
  ["Clock & timer", "Elapsed time, a countdown, or the time of day in any time zone."],
  ["Keypad controls", "Which keypad codes mute, lock, change layout or end the meeting on room systems and phones."],
  ["Voice prompts", "Replace any of the 44 spoken prompts. Upload any audio format or record in the browser."],
  ["Avatars", "Show avatars for audio-only and camera-off participants."],
];

/**
 * Infinity's default splash screen wording, from Pexip's theme_screen_defaults_v41.json
 * (https://docs.pexip.com/files/v41/theme_screen_defaults_v41.json).
 * {conference_id} and {conference_name} are filled in by Infinity.
 */
export const DEFAULT_LABEL_TEXT = {
  welcome: "Welcome",
  connecting: "Connecting...",
  timeout: "Time exceeded",
  waiting_for_host: "Waiting for the host...",
  other_participants_audio_only: "Other participants\nare not sharing video",
  insufficient_video_licenses: "Insufficient video licenses\nYou can still share content and audio",
  invalid_license: "Invalid license",
  capacity_exceeded: "Capacity\nexceeded",
  insufficient_licenses: "Insufficient licenses",
  please_enter_pin: "Please enter the PIN",
  pin_correct: "Welcome",
  invalid_pin: "Invalid PIN\nPlease try again",
  enter_conference_id: "Enter conference ID",
  conference_id_entry: "{conference_id}",
  conference_id_invalid: "Conference ID invalid",
  virtual_reception_connecting: "{conference_name}",
  test_call_welcome_header: "Live Test",
  test_call_welcome_text: "Let's test your video and\naudio. Count out loud\nfrom one to three...",
  test_call_in_progress: "You will hear and see yourself with a two second delay",
  test_call_complete: "If you have technical issues,\ncheck your settings or\ncontact your administrator",
  no_presentation: "Waiting for presentation...",
  stream_waiting: "Streaming will begin shortly...",
  streaming_in_progress: "Your video is\nbeing streamed",
  inlobby: "Welcome to the lobby,\nyour meeting host will admit you soon",
  inlobby_status_unknown: "Call connecting...",
  direct_media_escalate: "You are about to be transferred\ninto a multi-party conference",
  direct_media_deescalate: "You are about to be transferred\ninto a one-to-one call",
  host_left: "The host has left the conference.\nYour call will be disconnected shortly.",
};

/**
 * What Infinity's default voice prompts say, from Pexip's theme documentation (v42):
 * https://docs.pexip.com/admin/themes_file_requirements.htm
 * text: the spoken words (null when silent); silent: the default file is empty;
 * only: prompts Infinity only plays to callers gatewayed into Google Meet and/or Microsoft Teams.
 */
export const DEFAULT_PROMPTS = {
  "2sd-invalid-number-three-times-disconnect_48kHz_mono.wav": { text: "You have entered an invalid number three times. I will now disconnect the call." },
  "2sd-not-entered-valid-number-disconnect-call_48kHz_mono.wav": { text: "You have not entered a valid number. I will now disconnect the call." },
  "2sd-number-not-valid-try-again_48kHz_mono.wav": { text: "That number is not valid. Please try again." },
  "2sd-number-pound-key_48kHz_mono.wav": { text: "Please enter the number you wish to connect to, followed by the pound key." },
  "2sd-please-hold-connect-you_48kHz_mono.wav": { text: "Please hold while I try to connect you." },
  "call_about_to_be_transferred.wav": { text: "Your call is about to be transferred." },
  "call_about_to_transfer_to_main_room.wav": { text: "Your call is about to be transferred to the main room." },
  "conf-ai_started_48kHz_mono.wav": { text: "This call is being processed by AI.", only: "google-meet" },
  "conf-ai_stopped_48kHz_mono.wav": { text: "AI has stopped processing this call.", only: "google-meet" },
  "conf-call-will-be-disconnected_48kHz_mono.wav": { text: "Your call will be disconnected." },
  "conf-capacity_exceeded_48kHz_mono.wav": { text: "The conferencing system capacity has been exceeded." },
  "conf-classification-changed_48kHz_mono.wav": { text: null, silent: true },
  "conf-external-media-processing-start_48kHz_mono.wav": { text: "An external application is collecting media.", only: "google-meet" },
  "conf-external-media-processing-stopped_48kHz_mono.wav": { text: "Media is no longer being collected by an external application.", only: "google-meet" },
  "conf-getpin_48kHz_mono.wav": { text: "Please enter the conference PIN number." },
  "conf-getpin_pound-key_48kHz_mono.wav": { text: "Please enter the conference PIN number, followed by the pound key." },
  "conf-insufficient_licenses_48kHz_mono.wav": { text: "There are insufficient conferencing system licenses available." },
  "conf-invalid_license_48kHz_mono.wav": { text: "The conferencing system license is invalid." },
  "conf-invalidpin_48kHz_mono.wav": { text: "The PIN is invalid for this conference." },
  "conf-leaderhasleft_48kHz_mono.wav": { text: "The Host has left the conference. The conference is about to end." },
  "conf-live_captions_started_48kHz_mono.wav": { text: "Live captions are enabled. Your continued participation in this call will be considered as consent." },
  "conf-live_captions_stopped_48kHz_mono.wav": { text: "Live captions are not in use." },
  "conf-participant_entry_tone_48kHz_mono.wav": { text: null, silent: true },
  "conf-participant_exit_tone_48kHz_mono.wav": { text: null, silent: true },
  "conf-participant_is_in_lobby_48kHz_mono.wav": { text: "Welcome to the lobby. Please wait and your meeting host will admit you soon.", only: "teams" },
  "conf-participant_locked_out_48Khz_mono.wav": { text: "(three knocks)" },
  "conf-placeintoconf_48kHz_mono.wav": { text: "Welcome to the conference." },
  "conf-public_streaming_started_48kHz_mono.wav": { text: "This call is being streamed publicly.", only: "google-meet" },
  "conf-public_streaming_stopped_48kHz_mono.wav": { text: "Public streaming of this call has stopped.", only: "google-meet" },
  "conf-recording_started_48kHz_mono.wav": { text: "This call is being recorded.", only: "google-meet-or-teams" },
  "conf-recording_stopped_48kHz_mono.wav": { text: "Recording of this call has stopped.", only: "google-meet-or-teams" },
  "conf-smart_notes_started_48kHz_mono.wav": { text: "This call is now taking notes." },
  "conf-smart_notes_stopped_48kHz_mono.wav": { text: "This call is no longer taking notes." },
  "conf-streaming_started_48kHz_mono.wav": { text: "This call is being streamed.", only: "google-meet" },
  "conf-streaming_stopped_48kHz_mono.wav": { text: "Streaming of this call has stopped.", only: "google-meet" },
  "conf-test_call_48kHz_mono.wav": { text: "Let's test your video and audio. Count out loud from one to three, now." },
  "conf-test_call_audio_only_48kHz_mono.wav": { text: "Let's test your audio settings. Count out loud from one to three, now." },
  "conf-test_call_disconnect_48kHz_mono.wav": { text: "If you have technical issues, check your settings or contact your administrator." },
  "conf-transcribing_started_48kHz_mono.wav": { text: "This call is being transcribed.", only: "google-meet-or-teams" },
  "conf-transcribing_stopped_48kHz_mono.wav": { text: "Transcribing of this call has stopped.", only: "google-meet-or-teams" },
  "conf-waitforleader_48kHz_mono.wav": { text: "Waiting for the conference Host to join." },
  "conf-waithostpin_48kHz_mono.wav": { text: "Waiting for the conference Host to join. If you are the conference Host, please enter the conference PIN number now." },
  "conf-waithostpin_pound-key_48kHz_mono.wav": { text: "Waiting for the conference Host to join. If you are the conference Host, please enter the conference PIN number followed by the pound key." },
  "conf-you_are_the_only_participant_48kHz_mono.wav": { text: "You are the only participant in the conference." },
};

export const GATEWAY_ONLY = {
  "google-meet": "Only played to callers joining Google Meet through Infinity",
  "teams": "Only played to callers joining Microsoft Teams through Infinity",
  "google-meet-or-teams": "Only played to callers joining Google Meet or Microsoft Teams through Infinity",
};

/** In-conference indicator icons (rules.NOTCH_ICONS): what each one shows. */
export const NOTCH_ICON_INFO = {
  participants: { title: "Participant count", help: "Shown with the number of people in the meeting." },
  audio: { title: "Audio-only participants", help: "Shown with the number of people joined by audio only." },
  video_muted: { title: "Camera off", help: "Shown with the number of people whose camera is off." },
  raised_hand: { title: "Raised hand", help: "Shown with the number of raised hands." },
  conference_locked: { title: "Meeting locked", help: "Shown while the meeting is locked." },
  conference_unlocked: { title: "Meeting unlocked", help: "Shown briefly when the meeting is unlocked." },
  recording: { title: "Recording", help: "Shown while the meeting is recorded. Red by default." },
  streaming: { title: "Streaming", help: "Shown while the meeting is streamed." },
  public_streaming: { title: "Public streaming", help: "Shown while the meeting is streamed publicly." },
  transcribing: { title: "Transcribing", help: "Shown while the meeting is transcribed. Red by default." },
  live_captions: { title: "Live captions", help: "Shown when live captions are on." },
  ai: { title: "AI", help: "Shown while AI services are active." },
  smart_notes: { title: "Smart notes", help: "Shown while notes are being taken." },
  external_media_proc: { title: "External media processing", help: "Shown while media is sent to an external application." },
};
