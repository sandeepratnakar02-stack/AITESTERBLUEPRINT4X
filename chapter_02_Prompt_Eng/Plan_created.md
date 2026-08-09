I'll research the workspace first to understand the RICE-POT framework and the existing files before building a plan.

Read [](file:///c%3A/AITESTERBLUEPRINT4X/chapter_02_Prompt_Eng/02_RICE_POT.example.md)

Read [](file:///c%3A/AITESTERBLUEPRINT4X/chapter_02_Prompt_Eng/00_Task1.md)

Read [](file:///c%3A/AITESTERBLUEPRINT4X/chapter_02_Prompt_Eng/01_RICE_POT_Template.md)

Read [](file:///c%3A/AITESTERBLUEPRINT4X/chapter_01_LLM_BASICS/ANTI-HALLUCINATION.rules.md)

Let me look at the full workspace structure to see if any existing project exists.

Read [](file:///c%3A/AITESTERBLUEPRINT4X)

Searched for files matching `**/*.{java,xml,properties,md}`, 4 matches

The workspace contains only the prompt-engineering study files (`RICE_POT_Template.md`, etc.) — there's no existing Java/Selenium project yet. Before I build the plan, let me clarify a few key points so the plan matches your intent.

Analyzing your answers...

The user's choices are clear. Let me persist the plan and present it.

Created memory file [](file:///c%3A/Users/abit/AppData/Roaming/Code/User/workspaceStorage/d039a713a717431e44d26adc2233c95a/GitHub.copilot-chat/memory-tool/memories/OWI5YzBmNjQtMjhkZi00YTMwLTgwZmItYzVhMTg1YTRlYzg1/plan.md)

Here's the plan I've built from the RICE-POT prompt. It treats the prompt as a spec for building a real, runnable enterprise Selenium framework in your workspace.

---

## Plan: Salesforce Login Selenium Framework

**TL;DR** — Build a minimal-but-clean enterprise Selenium/Java/Maven/TestNG project in `c:\AITESTERBLUEPRINT4X\selenium-salesforce-framework\` that automates **valid + invalid** login tests for `login.salesforce.com/?locale=in`. It uses Page Object Model + PageFactory (XPath-only), TestNG setup/teardown, robust exception handling, WebDriverWait (zero `Thread.sleep`), and Chrome via WebDriverManager. Locators are verified against the live DOM (per your anti-hallucination rules); your external URL/credentials live in `config.properties`.

**Steps**

**Phase 1 — Preflight & scaffold** *(independent)*
1. Verify prerequisites: JDK 8+/11, Maven 3.8+, Chrome installed.
2. Create the Maven layout `selenium-salesforce-framework/` with `src/main/java`, `src/test/java`, `src/test/resources`.

**Phase 2 — Project config** *depends on 1*
3. `pom.xml` — `selenium-java` (4.x), `testng` (7.x), `webdrivermanager` (5.x), surefire plugin wired to `testng.xml`, Java 11 compiler.
4. `testng.xml` — suite referencing both test classes.
5. `config.properties` — `url`, `username`, `password` placeholders (you supply real external creds later).

**Phase 3 — Live DOM locator capture** *depends on 1, anti-hallucination step*
6. Open `login.salesforce.com/?locale=in`, inspect the DOM, and confirm/capture XPaths for username, password, Login button, remember-me checkbox, the invalid-login error text, and a post-login success indicator (depends on your real org/creds).

**Phase 4 — Page Object** *depends on 6*
7. `LoginPage.java` — PageFactory constructor, `@FindBy(xpath=...)` fields (XPath only), reusable `doLogin(user, pass)`, `checkRememberMe()`, `getErrorMessage()`, `isLoginSuccess()`; explicit `WebDriverWait` + structured try-catch.

**Phase 5 — Test scripts** *depends on 7*
8. `LoginTest_Valid.java` — `@BeforeTest` setup (WebDriverManager → ChromeDriver, navigate), `@Test` valid-login flow + success verification, `@AfterTest` teardown (quit).
9. `LoginTest_Invalid.java` — `@BeforeTest`/`@AfterTest`, `@DataProvider` for multiple invalid combos, `@Test` asserts the error message, try-catch/soft assertions.

**Phase 6 — Verification** *depends on 8,9*
10. `mvn clean compile`, run the suite via `mvn test`, and a grep audit for no `Thread.sleep` / no non-XPath locators.

**Relevant files**
- `c:\AITESTERBLUEPRINT4X\selenium-salesforce-framework\pom.xml`
- `c:\AITESTERBLUEPRINT4X\selenium-salesforce-framework\testng.xml`
- `c:\AITESTERBLUEPRINT4X\selenium-salesforce-framework\src\test\resources\config.properties`
- `c:\AITESTERBLUEPRINT4X\selenium-salesforce-framework\src\main\java\com\salesforce\framework\pages\LoginPage.java`
- `c:\AITESTERBLUEPRINT4X\selenium-salesforce-framework\src\test\java\com\salesforce\framework\tests\LoginTest_Valid.java`
- `c:\AITESTERBLUEPRINT4X\selenium-salesforce-framework\src\test\java\com\salesforce\framework\tests\LoginTest_Invalid.java`

**Verification**
1. `mvn clean compile` passes with zero errors.
2. `mvn test` runs the TestNG suite — invalid tests pass; valid test passes once you supply real credentials.
3. Grep audit: no `Thread.sleep`, no `By.cssSelector`/`By.id`/`By.name` anywhere in main/test code.

**Decisions**
- Matches the prompt literally: 1 Page Object + 2 TestNG scripts + minimal `pom.xml`/`testng.xml`/`config.properties`.
- Locators and error text are captured from the live DOM, never assumed (honors your ANTI-HALLUCINATION.rules.md).
- Success assertion is org-specific (Lightning vs Classic) and confirmed in Phase 3 with your credentials.

**Further Considerations**
1. **Base class** — setup/teardown will be duplicated in both scripts to honor the literal "2 scripts" limit; a small `BaseTest.java` is the cleaner DRY alternative if you're okay with one extra file. *(Recommended: add it)*
2. **Credentials** — the valid-login test needs your external username/password; until provided it stays gated/`skip` on missing config.
3. **Study doc** — the open 02_RICE_POT.example.md can be filled in separately as a learning artifact; it's outside this framework's scope.

Want me to proceed with this plan, adjust the scope (e.g., add the `BaseTest`), or refine anything first?