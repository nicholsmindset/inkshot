"""Exercise local account entry and stale-session recovery without sending email."""
import uuid
from urllib.parse import urlparse

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

origin = "http://127.0.0.1:3001"
email = f"journey-{uuid.uuid4().hex}@example.test"
password = "Inkshot-browser-check-2026!"
options = webdriver.ChromeOptions()
options.add_argument("--headless=new")
options.add_argument("--disable-dev-shm-usage")
with webdriver.Chrome(options=options) as browser:
    wait = WebDriverWait(browser, 45)

    def field(name):
        return wait.until(lambda driver: driver.find_element(By.NAME, name))

    def button(label):
        return wait.until(lambda driver: next((item for item in driver.find_elements(By.TAG_NAME, "button")
            if item.is_displayed() and item.is_enabled() and item.text.strip() == label), False))

    def path_is(path):
        wait.until(lambda driver: urlparse(driver.current_url).path == path)

    def studio():
        return browser.execute_async_script("""
            const done = arguments[0];
            fetch('/api/studio').then(async response => done({status: response.status, body: await response.json()}));
        """)

    # Hold the anonymous studio response until after signup succeeds. Auth must
    # issue a fresh read, and the late 401 must never clear the new session.
    delay_script = browser.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": """
        const originalFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
            if (input === '/api/studio' && !window.__heldFirstStudio) {
                window.__heldFirstStudio = true;
                return originalFetch(input, init).then(response => new Promise(resolve => {
                    window.__releaseFirstStudio = () => resolve(response);
                }));
            }
            return originalFetch(input, init);
        };
    """})
    browser.get(origin + "/login?confirmation=failed")
    wait.until(lambda driver: driver.execute_script("return typeof window.__releaseFirstStudio === 'function'"))
    assert "confirmation link could not be used" in browser.find_element(By.CSS_SELECTOR, "[role=alert]").text
    field("email").send_keys(email)
    field("password").send_keys("incorrect-password")
    button("Open my studio").click()
    wait.until(lambda driver: any("email and password do not match" in item.text
        for item in driver.find_elements(By.CSS_SELECTOR, "[role=alert]")))
    browser.find_element(By.LINK_TEXT, "Create an account").click()
    path_is("/signup")
    assert not browser.find_elements(By.CSS_SELECTOR, "[role=alert]")
    assert field("email").get_attribute("value") == ""
    field("name").send_keys("Browser Journey")
    field("email").send_keys(email)
    field("password").send_keys(password)
    button("Create my studio").click()
    path_is("/studio/brand")
    wait.until(lambda driver: driver.find_element(By.CSS_SELECTOR, ".user-row strong").text == "Browser Journey")
    account = studio()["body"]["user"]
    browser.execute_async_script("const done=arguments[0]; window.__releaseFirstStudio(); setTimeout(done, 0);")
    assert urlparse(browser.current_url).path == "/studio/brand"
    assert browser.find_element(By.CSS_SELECTOR, ".user-row strong").text == "Browser Journey"

    # Disable the artificial delay for subsequent full page navigations.
    browser.execute_cdp_cmd("Page.removeScriptToEvaluateOnNewDocument", {"identifier": delay_script["identifier"]})
    browser.get(origin + "/login")
    path_is("/studio")
    browser.execute_script("""
        const actualFetch = window.fetch.bind(window);
        let failedLogout = false;
        window.fetch = (path, init) => {
            if (path === '/api/auth/logout' && !failedLogout) {
                failedLogout = true;
                return Promise.resolve(Response.json({error: 'Sign-out could not finish. Please try again.'}, {status: 503}));
            }
            return actualFetch(path, init);
        };
    """)
    wait.until(lambda driver: driver.find_element(By.CSS_SELECTOR, "button[aria-label='Sign out']")).click()
    button("Try signing out again")
    assert urlparse(browser.current_url).path == "/studio"
    assert studio()["status"] == 200
    button("Try signing out again").click()
    path_is("/")
    assert studio()["status"] == 401
    browser.find_element(By.LINK_TEXT, "Log in").click()
    path_is("/login")
    field("email").send_keys(email)
    field("password").send_keys(password)
    button("Open my studio").click()
    path_is("/studio")
    returned = studio()["body"]["user"]
    assert returned["id"] == account["id"]
    assert returned["workspaceId"] == account["workspaceId"]
    browser.find_element(By.CSS_SELECTOR, "button[aria-label='Sign out']").click()
    path_is("/")
    browser.get(origin + "/forgot-password")
    field("email").send_keys(email)
    button("Email recovery link").click()
    wait.until(lambda driver: "unavailable in the local preview" in driver.find_element(By.CSS_SELECTOR, "[role=alert]").text)
    assert browser.find_element(By.CSS_SELECTOR, "form").is_displayed()
    print("Signup, confirmation-error guidance, late 401, signout, returning login and honest recovery failure verified.")
