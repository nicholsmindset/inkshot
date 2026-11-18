"""Run against a fresh, locally hosted Inkshot mock studio in Chrome."""
import hashlib
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

origin = "http://127.0.0.1:3001"
with tempfile.TemporaryDirectory() as download_dir:
    options = webdriver.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--disable-dev-shm-usage")
    options.add_experimental_option("prefs", {"download.default_directory": download_dir})
    with webdriver.Chrome(options=options) as browser:
        wait = WebDriverWait(browser, 180)
        browser.get(origin)

        def api(path, body=None):
            result = browser.execute_async_script("""
                const [path, body, done] = arguments;
                const options = body === null ? {} : {
                    method: "POST", headers: {"Content-Type": "application/json"},
                    body: JSON.stringify(body)
                };
                fetch("/api" + path, options).then(async response =>
                    done([response.status, await response.json()])
                ).catch(error => done([0, String(error)]));
            """, path, body)
            assert 200 <= result[0] < 300, result
            return result[1]

        def element(css):
            return wait.until(lambda driver: driver.find_element(By.CSS_SELECTOR, css))

        def button(label):
            return wait.until(lambda driver: next((b for b in driver.find_elements(By.TAG_NAME, "button")
                if b.text.strip() == label and b.is_enabled() and b.is_displayed()), False))

        assert api("/health")["demoAvailable"]
        api("/auth/demo", {})
        campaign = api("/campaigns", {"name": "Bakery launch", "goal": "Sales", "offer": "Friday pre-orders"})
        draft = api(f"/campaigns/{campaign['id']}/prompts", {
            "revision": 0,
            "selectedConceptIds": [concept["id"] for concept in campaign["concepts"][:3]],
        })
        api(f"/campaigns/{campaign['id']}/generate", {"approved": True, "draftRevision": draft["revision"]})

        def ready_image(_):
            return next((a for a in api("/studio")["assets"] if a["kind"] == "image"
                         and a["versions"][0]["status"] == "ready"), False)

        original = wait.until(ready_image)
        browser.get(origin + "/studio/library")
        button("Images").click()
        card = wait.until(lambda driver: next((c for c in driver.find_elements(By.CSS_SELECTOR, ".asset-card")
            if c.find_element(By.TAG_NAME, "h3").text == original["title"]), False))
        card.click()
        headline = "Pre-order your Friday bake"
        element(".headline-variations textarea").send_keys(headline)
        button("Create headline variations").click()
        comparison = element(".variation-compare")
        wait.until(lambda _: len(comparison.find_elements(By.CSS_SELECTOR, "figure img")) == 2)
        images = comparison.find_elements(By.TAG_NAME, "img")
        assert images[1].get_attribute("alt") == headline
        assert images[0].get_attribute("src") != images[1].get_attribute("src")
        wait.until(lambda driver: driver.execute_script(
            "return [...document.querySelectorAll('.variation-compare img')].every(i => i.naturalWidth > 0)"))
        selected_url = images[1].get_attribute("src")
        selected_id = selected_url.rsplit("/", 1)[-1]
        # A worker may have already made the freshly rendered version current.
        def selected(_):
            return next(a for a in api("/studio")["assets"] if a["id"] == original["id"])["current_version_id"]
        if selected(None) != selected_id:
            button("Use this version").click()
        wait.until(lambda _: selected(None) == selected_id)
        download = element(".editor-footer a")
        assert download.get_attribute("href") == selected_url + "?download=true"
        download.click()
        downloaded = wait.until(lambda _: next((p for p in Path(download_dir).glob(f"inkshot-{selected_id}.*")
            if p.is_file() and p.suffix != ".crdownload" and p.stat().st_size > 0), False))
        cookies = "; ".join(c["name"] + "=" + c["value"] for c in browser.get_cookies())
        def digest(url):
            with urlopen(Request(url, headers={"Cookie": cookies}), timeout=20) as response:
                return hashlib.sha256(response.read()).digest()
        assert hashlib.sha256(downloaded.read_bytes()).digest() == digest(selected_url)
        assert digest(selected_url) != digest(images[0].get_attribute("src"))
        print("Single variation rendered, compared, selected, and downloaded with verified bytes.")
