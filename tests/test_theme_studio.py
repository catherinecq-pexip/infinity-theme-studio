"""Unit tests (stdlib unittest; also runnable with pytest)."""

from __future__ import annotations

import io
import json
import shutil
import tempfile
import unittest
import wave
from pathlib import Path

from theme_studio import package, rules
from theme_studio.api import Connection, ThemeClient
from theme_studio.cli import list_profiles, main
from theme_studio.finish import deep_merge, finish, is_infinity_wav, load_overlay
from theme_studio.package import Theme
from theme_studio.validate import validate

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None

PROFILES = Path(__file__).resolve().parents[1] / "src" / "theme_studio" / "profiles"


def cfg(**kw) -> bytes:
    data = {"theme_version": 2}
    data.update(kw)
    return json.dumps(data).encode()


def wav_bytes(channels=1, width=2, rate=48000, frames=480) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        w.writeframes(b"\x00" * frames * channels * width)
    return buf.getvalue()


def jpg_bytes(size=(1920, 1080), mode="RGB") -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size).save(buf, "JPEG")
    return buf.getvalue()


def png_bytes(size=(200, 100)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", size).save(buf, "PNG")
    return buf.getvalue()


def messages(report) -> str:
    return "\n".join(str(i) for i in report.issues)


class ConfigTests(unittest.TestCase):
    def test_minimal_theme_is_valid(self):
        r = validate(Theme("t", {"themeconfig.json": cfg()}))
        self.assertTrue(r.ok, messages(r))

    def test_missing_config_and_version(self):
        self.assertFalse(validate(Theme("t", {"watermark_icon.png": b"x"})).ok)
        r = validate(Theme("t", {"themeconfig.json": b"{}"}))
        self.assertIn("theme_version", messages(r))

    def test_bad_json_reports_position(self):
        r = validate(Theme("t", {"themeconfig.json": b'{"theme_version": 2,}'}))
        self.assertFalse(r.ok)
        self.assertIn("line 1", messages(r))

    def test_unknown_key_is_warning(self):
        r = validate(Theme("t", {"themeconfig.json": cfg(disable_watermark_icn=True)}))
        self.assertTrue(r.ok)
        self.assertEqual(len(r.warnings), 1)

    def test_types_and_lengths(self):
        r = validate(Theme("t", {"themeconfig.json": cfg(
            disable_watermark_icon="yes",
            conference_locked_indicator_text="x" * 21,
            text_color="red")}))
        self.assertEqual(len(r.errors), 3, messages(r))

    def test_dtmf(self):
        r = validate(Theme("t", {"themeconfig.json": cfg(dtmf_conference_control_commands={
            "*6": "toggle_self_mute", "123": "toggle_lock", "*8": "dance"})}))
        self.assertEqual(len(r.errors), 2, messages(r))

    def test_classification(self):
        good = {"levels": {"0": "Internal", "1": {"text": "Secret", "bgcolor": "0xff0000"}}, "default": 1}
        self.assertTrue(validate(Theme("t", {"themeconfig.json": cfg(classification=good)})).ok)
        bad = {"levels": {"a": "x", "1": {"bgcolor": "red"}}, "default": 5}
        r = validate(Theme("t", {"themeconfig.json": cfg(classification=bad)}))
        self.assertGreaterEqual(len(r.errors), 3, messages(r))

    def test_clock(self):
        ok = [{"type": "elapsed"}, {"type": "remaining", "starting_value": 600},
              {"type": "time", "timezone": "Europe/London", "date": "dd/mm/yyyy"}]
        for c in ok:
            r = validate(Theme("t", {"themeconfig.json": cfg(clock_data=c)}))
            self.assertTrue(r.ok, messages(r))
        bad = [{"type": "stopwatch"}, {"type": "remaining"}, {"type": "time", "timezone": "Mars/Base"}]
        for c in bad:
            self.assertFalse(validate(Theme("t", {"themeconfig.json": cfg(clock_data=c)})).ok, c)

    def test_indicator_colors_require_all_keys(self):
        r = validate(Theme("t", {"themeconfig.json": cfg(indicator_color_config={
            "recording": {"background": "0x33D73332", "text": "0xFFFFFFFF"}})}))
        self.assertFalse(r.ok)

    def test_splash_screens(self):
        ss = {"labels": {"my_label": "Hello"},
              "screens": {"welcome": {"background": {"path": "background_welcome.jpg"},
                                      "elements": [{"type": "text", "label": "my_label", "font": "Inter"},
                                                   {"type": "icon", "path": "icon_welcome.svg"}]}}}
        r = validate(Theme("t", {"themeconfig.json": cfg(splash_screens=ss)}))
        self.assertIn("background_welcome.jpg", messages(r))  # referenced but not in ZIP
        ss["screens"]["welcome"]["elements"][0]["font"] = "Comic Sans"
        ss["screens"]["welcome"]["background"] = {"color": "0x323232"}
        r = validate(Theme("t", {"themeconfig.json": cfg(splash_screens=ss)}))
        self.assertEqual(len(r.errors), 1, messages(r))


class FileTests(unittest.TestCase):
    def test_audio(self):
        name = "conf-getpin_48kHz_mono.wav"
        self.assertTrue(validate(Theme("t", {"themeconfig.json": cfg(), name: wav_bytes()})).ok)
        for bad in (wav_bytes(channels=2), wav_bytes(rate=44100), wav_bytes(width=1), b"not audio"):
            self.assertFalse(validate(Theme("t", {"themeconfig.json": cfg(), name: bad})).ok)
        r = validate(Theme("t", {"themeconfig.json": cfg(), "hello.wav": wav_bytes()}))
        self.assertTrue(r.ok)
        self.assertIn("will not replace", messages(r))

    @unittest.skipIf(Image is None, "Pillow not installed")
    def test_images(self):
        ok = Theme("t", {"themeconfig.json": cfg(), "background.jpg": jpg_bytes(),
                         "watermark_icon.png": png_bytes()})
        self.assertTrue(validate(ok).ok, messages(validate(ok)))
        for files in ({"background.jpg": jpg_bytes((1280, 720))},
                      {"background.jpg": jpg_bytes(mode="L")},
                      {"background.jpg": png_bytes()}):
            files["themeconfig.json"] = cfg()
            self.assertFalse(validate(Theme("t", files)).ok)

    def test_svg(self):
        good = b'<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>'
        self.assertTrue(validate(Theme("t", {"themeconfig.json": cfg(), "icon_x.svg": good})).ok)
        self.assertFalse(validate(Theme("t", {"themeconfig.json": cfg(), "icon_x.svg": b"<svg"})).ok)

    def test_custom_layout(self):
        layout = json.dumps({"name": "my layout", "modes": []}).encode()
        r = validate(Theme("t", {"themeconfig.json": cfg(), "custom_layout_x.json": layout}))
        self.assertEqual(len(r.errors), 2, messages(r))


class PackageTests(unittest.TestCase):
    def test_zip_roundtrip_wraps_and_unwraps_folder(self):
        t = Theme("secure", {"themeconfig.json": cfg()})
        data = package.to_zip_bytes(t)
        back = package.load_zip_bytes(data, "secure")
        self.assertEqual(back.files, t.files)
        flat = package.load_zip_bytes(package.to_zip_bytes(t, wrap_folder=False), "secure")
        self.assertEqual(flat.files, t.files)


class FinishTests(unittest.TestCase):
    def test_deep_merge(self):
        base = {"a": {"b": 1, "c": 2}, "l": [1]}
        self.assertEqual(deep_merge(base, {"a": {"c": 3}, "l": [2], "$comment": "x"}),
                         {"a": {"b": 1, "c": 3}, "l": [2]})

    def test_all_profiles_produce_valid_themes(self):
        self.assertEqual(set(list_profiles()), {"standard", "secure", "event", "client", "reception"})
        for p in PROFILES.glob("*.json"):
            theme, _ = finish(None, p.stem, [load_overlay(p)])
            r = validate(theme)
            self.assertTrue(r.ok, f"{p.stem}: {messages(r)}")

    def test_finish_keeps_portal_settings_and_adds_audio(self):
        portal = Theme("portal", {"themeconfig.json": cfg(text_color="0xff0000")})
        tmp = Path(tempfile.mkdtemp())
        try:
            (tmp / "conf-getpin_48kHz_mono.wav").write_bytes(wav_bytes())
            theme, log = finish(portal, "secure", [load_overlay(PROFILES / "secure.json")], audio_dir=tmp)
        finally:
            shutil.rmtree(tmp)
        conf = theme.load_config()
        self.assertEqual(conf["text_color"], "0xff0000")
        self.assertIn("classification", conf)
        self.assertTrue(is_infinity_wav(theme.files["conf-getpin_48kHz_mono.wav"]))

    @unittest.skipIf(shutil.which("ffmpeg") is None, "ffmpeg not installed")
    def test_finish_converts_audio(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            (tmp / "conf-placeintoconf_48kHz_mono.wav").write_bytes(wav_bytes(channels=2, rate=44100))
            theme, _ = finish(None, "t", audio_dir=tmp)
        finally:
            shutil.rmtree(tmp)
        self.assertTrue(is_infinity_wav(theme.files["conf-placeintoconf_48kHz_mono.wav"]))


class FakeResponse:
    def __init__(self, status=200, payload=None, headers=None):
        self.status_code, self._payload, self.headers, self.text = status, payload or {}, headers or {}, ""

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self):
        self.calls = []
        self.themes, self.services = [], [{"name": "Secure Test", "resource_uri": "/api/admin/configuration/v1/conference/7/"}]

    def get(self, url, params=None):
        self.calls.append(("GET", url, params))
        pool = self.themes if "ivr_theme" in url else self.services
        return FakeResponse(payload={"objects": [o for o in pool if o["name"] == params["name"]]})

    def post(self, url, json=None):
        self.calls.append(("POST", url, json))
        uri = "/api/admin/configuration/v1/ivr_theme/3/"
        self.themes.append({"name": json["name"], "resource_uri": uri})
        return FakeResponse(201, headers={"location": f"https://mgr.example.com{uri}"})

    def patch(self, url, json=None, files=None):
        self.calls.append(("PATCH", url, json or sorted(files)))
        return FakeResponse(202)


class ApiTests(unittest.TestCase):
    def test_upload_creates_then_updates_and_assigns(self):
        s = FakeSession()
        client = ThemeClient(Connection("mgr.example.com", "u", "p"), session=s)
        path = client.upload_theme("secure", b"zip")
        self.assertEqual(path, "/api/admin/configuration/v1/ivr_theme/3/")
        client.upload_theme("secure", b"zip2")  # second time: no new POST
        self.assertEqual(sum(1 for c in s.calls if c[0] == "POST"), 1)
        client.assign_theme(path, "Secure Test")
        self.assertEqual(s.calls[-1], ("PATCH", "https://mgr.example.com/api/admin/configuration/v1/conference/7/",
                                       {"ivr_theme": path}))


class CliTests(unittest.TestCase):
    def test_finish_and_validate_cli(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            out = tmp / "secure.zip"
            self.assertEqual(main(["finish", "--name", "secure", "--profile", "secure", "--out", str(out)]), 0)
            self.assertEqual(main(["validate", str(out)]), 0)
            self.assertEqual(main(["upload", str(out), "--dry-run", "--assign", "Secure Test"]), 0)
        finally:
            shutil.rmtree(tmp)


if __name__ == "__main__":
    unittest.main()
