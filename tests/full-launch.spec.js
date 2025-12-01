const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');
const os = require('os');

test.describe('Full Cycle Launch Test (macOS)', () => {
    let electronApp;

    // Даем тесту 5 минут. Скачивание Java и ассетов — дело небыстрое.
    test.setTimeout(300000);

    test.beforeAll(async () => {
        // --- ЛОГИРОВАНИЕ ЖЕЛЕЗА ---
        console.log('========================================');
        console.log('       HARDWARE INFO (VM SPECS)         ');
        console.log('========================================');
        try {
            const cpus = os.cpus();
            console.log(`CPU Model: ${cpus[0].model}`);
            console.log(`CPU Cores: ${cpus.length}`);
            console.log(`Total RAM: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`);
            console.log(`Platform:  ${os.platform()} ${os.release()}`);
            console.log('========================================');
        } catch (e) {
            console.log('Failed to get HW info:', e.message);
        }
        // -----------------------------

        electronApp = await electron.launch({ 
            args: [
                '.', 
                '--no-sandbox', 
                '--disable-dev-shm-usage', 
                '--use-gl=swiftshader', 
                '--disable-background-timer-throttling'
            ],
            timeout: 60000
        });
    });

    test.afterAll(async () => {
        if (electronApp) {
            await electronApp.close();
        }
    });

    test('should launch, handle RAM overlay, log CPU, and click Play', async () => {
        const window = await electronApp.firstWindow();
        
        // Логирование консоли приложения
        window.on('console', msg => {
            const txt = msg.text();
            // Логируем ошибки и сообщения загрузчика
            if (txt.includes('Error') || txt.includes('launch') || txt.includes('Distribution')) {
                console.log(`[App] ${txt}`);
            }
        });

        await window.waitForLoadState('domcontentloaded');
        console.log('DOM loaded. Waiting for UI...');

        // Локаторы
        const launchButton = window.locator('#launch_button');
        const overlay = window.locator('#overlayContainer');
        const overlayContinue = window.locator('#overlayAcknowledge');
        const launchProgress = window.locator('#launch_details'); // Прогресс бар
        const launchText = window.locator('#launch_details_text'); // Текст статуса загрузки

        const startTime = Date.now();
        // Ждем появления интерфейса (до 2 минут)
        while (Date.now() - startTime < 120000) { 
            
            // 1. Если видим оверлей (RAM) — закрываем его
            if (await overlay.isVisible()) {
                const text = await overlay.innerText();
                // Логируем текст оверлея для отладки
                // console.log(`Overlay text: ${text.substring(0, 50)}...`);

                if (text.includes('Технические проблемы') || text.includes('оперативной памяти')) {
                    console.log('Overlay: Low RAM detected. Clicking "Continue"...');
                    if (await overlayContinue.isVisible()) {
                        await overlayContinue.click();
                        // Ждем исчезновения оверлея
                        try {
                            await expect(overlay).toBeHidden({ timeout: 5000 });
                            console.log('Overlay dismissed successfully.');
                        } catch(e) {
                            console.log('Warning: Overlay did not hide immediately.');
                        }
                    }
                }
            }

            // 2. Если кнопка "Играть" появилась — выходим из цикла ожидания
            if (await launchButton.isVisible() && await launchButton.isEnabled()) {
                console.log('Main Menu reached: Launch button is visible!');
                break;
            }
            
            await new Promise(r => setTimeout(r, 1000));
        }

        // Проверяем, что кнопка найдена
        await expect(launchButton).toBeVisible();

        // 3. НАЖИМАЕМ "ИГРАТЬ"
        console.log('Clicking Launch button...');
        await launchButton.click();

        // 4. ПРОВЕРЯЕМ, ЧТО ПОШЕЛ ПРОЦЕСС
        console.log('Waiting for download process to start...');
        
        // Ждем либо появления прогресс-бара, либо изменения текста кнопки (Отмена/Загрузка)
        await Promise.race([
            launchProgress.waitFor({ state: 'visible', timeout: 30000 }),
            expect(launchButton).toHaveText(/Отмена|Загрузка|Запуск/i, { timeout: 30000 })
        ]);

        console.log('Test Pass: Download/Launch process started!');
        
        // Выводим текущий статус загрузки (если есть)
        if (await launchText.isVisible()) {
            const status = await launchText.innerText();
            console.log(`Current Launcher Status: "${status}"`);
        }
    });
});