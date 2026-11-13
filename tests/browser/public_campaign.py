"""Exercise the public campaign viewer against the built frontend in Chrome."""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.request import urlopen

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

base = "http://127.0.0.1:4173"
screens = Path(os.environ.get("RUNNER_TEMP", "/tmp")) / "inkshot-public"
screens.mkdir(exist_ok=True)
with TemporaryDirectory() as downloads:
    options = webdriver.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--autoplay-policy=no-user-gesture-required")
    options.add_experimental_option("prefs", {"download.default_directory": downloads})
    with webdriver.Chrome(options=options) as driver:
        wait = WebDriverWait(driver, 20)
        for width in (1440, 768, 390, 320):
            driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {
                "width": width, "height": 900, "deviceScaleFactor": 1, "mobile": False
            })
            for path in ("/", "/signup", "/login"):
                driver.get(base + path)
                wait.until(lambda d: d.find_elements(By.CLASS_NAME, "campaign-example"))
                driver.execute_async_script("document.fonts.ready.then(arguments[0])")
                assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth"), (width, path)
                for label, filename in (("Image ad", "bakery-image.jpg"), ("Video ad", "bakery-video.mp4"), ("Social post", "bakery-post.jpg")):
                    button = driver.find_element(By.XPATH, f"//button[normalize-space(.)='{label}']")
                    button.click()
                    wait.until(lambda d: button.get_attribute("aria-pressed") == "true")
                    if label == "Video ad":
                        driver.execute_script("let v=document.querySelector('video'); v.muted=true; v.play()")
                        wait.until(lambda d: d.execute_script("return document.querySelector('video').currentTime > 0"))
                        assert driver.execute_script("return document.querySelector('video').duration") == 5
                    else:
                        wait.until(lambda d: d.execute_script("return document.querySelector('.example-media img').naturalWidth > 0"))
                    link = driver.find_element(By.CSS_SELECTOR, ".example-copy a[download]")
                    assert link.get_attribute("href") == base + "/examples/" + filename
                    if path == "/" and width == 1440:
                        link.click()
                        file = Path(downloads) / filename
                        wait.until(lambda d: file.exists())
                        assert file.read_bytes() == urlopen(link.get_attribute("href")).read()
                if path == "/":
                    driver.find_element(By.XPATH, "//button[normalize-space(.)='Image ad']").click()
                    brief = driver.find_element(By.ID, "how")
                    logo = brief.find_element(By.CSS_SELECTOR, "img")
                    wait.until(lambda d: d.execute_script("return arguments[0].naturalWidth > 0", logo))
                    assert not brief.find_elements(By.CSS_SELECTOR, "a[href^='http']")
                    assert "Smart Calculator" in brief.text and "#B7102A" in brief.text
                    driver.execute_script("arguments[0].scrollIntoView({block:'center'})", brief)
                    brief.screenshot(str(screens / f"brand-brief-{width}.png"))
                    brief.find_element(By.LINK_TEXT, "Start with my website").click()
                    assert driver.switch_to.active_element.get_attribute("id") == "hero-website"
                    driver.execute_script("window.scrollTo(0,0)")
                    driver.save_screenshot(str(screens / f"homepage-{width}.png"))
            print(f"Passed landing, signup and login at {width}px", flush=True)
