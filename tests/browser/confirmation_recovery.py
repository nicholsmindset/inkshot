"""Check confirmation recovery UI; provider email responses are mocked, sessions are real."""
import json
import uuid
from urllib.parse import parse_qs, urlparse

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

origin = "http://127.0.0.1:3001"
email = f"confirmation-{uuid.uuid4().hex}@example.test"
password = "Inkshot-confirmation-check-2026!"
options = webdriver.ChromeOptions()
options.add_argument("--headless=new")
options.add_argument("--disable-dev-shm-usage")
options.add_argument("--window-size=1024,600")
with webdriver.Chrome(options=options) as browser:
    wait = WebDriverWait(browser, 30)

    def field(name):
        return wait.until(lambda driver: next((item for item in driver.find_elements(By.NAME, name)
            if item.is_displayed() and item.is_enabled()), False))

    def button(label):
        return wait.until(lambda driver: next((item for item in driver.find_elements(By.TAG_NAME, "button")
            if item.is_displayed() and item.is_enabled() and item.text.strip() == label), False))

    def path_is(path):
        wait.until(lambda driver: urlparse(driver.current_url).path == path)

    def api(path, body=None):
        return browser.execute_async_script("""
            const [path, body, done] = arguments;
            fetch(path, body === null ? undefined : {
                method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)
            }).then(async response => done({status: response.status, body: await response.json()}));
        """, path, body)

    browser.get(origin + "/login")
    field("email")
    assert api("/api/auth/signup", {"name": "Confirmation Journey", "email": email, "password": password})["status"] == 201
    account = api("/api/studio")["body"]["user"]
    assert api("/api/auth/logout", {})["status"] == 200

    # Model email responses without contacting an email service. Successful
    # verification signs into the real local fixture, so fresh-session routing
    # and workspace continuity are exercised rather than mocked.
    browser.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": """
        const actualFetch = window.fetch.bind(window);
        const actualTimeout = window.setTimeout.bind(window);
        window.__confirmationRequests = [];
        window.__resendFails = false;
        window.__fastCountdown = false;
        window.setTimeout = (callback, delay, ...args) => actualTimeout(callback,
            window.__fastCountdown && delay === 1000 ? 10 : delay, ...args);
        window.fetch = (path, init) => {
            if (['/api/auth/signup', '/api/auth/resend-confirmation', '/api/auth/verify-email'].includes(path)) {
                const body = JSON.parse(init.body);
                window.__confirmationRequests.push({path, body});
                if (path === '/api/auth/signup') return Promise.resolve(Response.json({confirmationRequired: true}, {status: 201}));
                if (path === '/api/auth/resend-confirmation') return Promise.resolve(window.__resendFails
                    ? Response.json({error: 'Confirmation email is temporarily unavailable. Please try again.'}, {status: 503})
                    : Response.json({ok: true}));
                if (body.token !== '123456') return Promise.resolve(Response.json({error: 'That confirmation code could not be used. Try your latest email.'}, {status: 400}));
                return actualFetch('/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(FIXTURE)});
            }
            return actualFetch(path, init);
        };
    """.replace("FIXTURE", json.dumps({"email": email, "password": password}))})

    browser.get(origin + "/signup")
    field("name").send_keys("Confirmation Journey")
    field("email").send_keys(email)
    field("password").send_keys(password)
    button("Create my studio").click()
    field("token")
    cooldown = next(item for item in browser.find_elements(By.TAG_NAME, "button") if "Resend available in" in item.text)
    assert not cooldown.is_enabled()
    assert "If your account needs confirmation" in browser.find_element(By.CSS_SELECTOR, "[role=status]").text
    button("Use a different email").click()
    assert field("email").get_attribute("value") == email
    assert field("name").is_displayed()
    assert not browser.find_elements(By.NAME, "token")

    browser.get(origin + "/login")
    button("Need a confirmation email?").click()
    field("email").send_keys(email.upper())
    browser.execute_script("window.__resendFails = true;")
    button("Send confirmation email").click()
    wait.until(lambda driver: "temporarily unavailable" in driver.find_element(By.CSS_SELECTOR, "[role=alert]").text)
    assert field("email").is_displayed()
    browser.execute_script("window.__resendFails = false;")
    button("Send confirmation email").click()
    field("token")
    assert "If this address has an account awaiting confirmation" in browser.find_element(By.CSS_SELECTOR, "[role=status]").text
    assert browser.find_element(By.CSS_SELECTOR, ".confirmation-address").text == email
    cooldown = next(item for item in browser.find_elements(By.TAG_NAME, "button") if "Resend available in" in item.text)
    assert not cooldown.is_enabled()
    # Accelerate only the display timer after proving the button is disabled.
    browser.execute_script("window.__fastCountdown = true;")
    button("Resend confirmation email").click()
    wait.until(lambda driver: len(driver.execute_script("return window.__confirmationRequests.filter(x => x.path.endsWith('resend-confirmation'))")) == 3)

    button("Use a different email").click()
    assert field("email").get_attribute("value") == email
    button("I already have a code").click()
    field("token").send_keys("000000")
    button("Confirm my email").click()
    wait.until(lambda driver: "code could not be used" in driver.find_element(By.CSS_SELECTOR, "[role=alert]").text)
    assert field("token").get_attribute("value") == "000000"
    assert button("Confirm my email").is_displayed()
    field("token").clear()
    field("token").send_keys("123456")
    button("Confirm my email").click()
    path_is("/studio")
    returned = api("/api/studio")["body"]["user"]
    assert returned["id"] == account["id"] and returned["workspaceId"] == account["workspaceId"]

    # A successful signup confirmation also retains the website and is usable
    # at a phone viewport, without horizontal overflow or hidden controls.
    assert api("/api/auth/logout", {})["status"] == 200
    browser.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {
        "width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True,
    })
    browser.get(origin + "/signup?website=https%3A%2F%2Fexample.com")
    field("name").send_keys("Confirmation Journey")
    field("email").send_keys(email)
    field("password").send_keys(password)
    button("Create my studio").click()
    field("token").send_keys("123456")
    assert browser.execute_script("return document.documentElement.scrollWidth <= window.innerWidth + 1")
    button("Confirm my email").click()
    path_is("/studio/brand")
    assert parse_qs(urlparse(browser.current_url).query)["website"] == ["https://example.com"]
    returned = api("/api/studio")["body"]["user"]
    assert returned["id"] == account["id"] and returned["workspaceId"] == account["workspaceId"]
    assert api("/api/auth/logout", {})["status"] == 200
    print("Confirmation UI: resend, cooldown, email correction, invalid code, cross-device entry and fresh-session redirects verified.")
