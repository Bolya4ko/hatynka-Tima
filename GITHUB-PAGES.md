# Публікація C13PowerDashboard на GitHub Pages

## Один раз на GitHub

1. Створіть репозиторій **SergeyMaximenko/C13PowerDashboard**. Локальний origin уже вказує на нього. Не надсилайте цей проєкт у старий SetTimeGenerator.
2. Завантажте код через GitHub Desktop або Git. Перевірте, що .local, dist, паролі та deye-settings.json не включені. У проєкті вже є .gitignore.
3. Settings → Secrets and variables → Actions → Secrets → New repository secret:
   - DEYE_APP_ID — ваш App ID.
   - DEYE_APP_SECRET — ваш App Secret.
   - DEYE_LOGIN — email або ім’я користувача Deye.
   - DEYE_PASSWORD — звичайний пароль Deye; програма сама обчислить потрібний хеш.
4. На сусідній вкладці Variables додайте:
   - DEYE_STATION_ID = 62524584
   - DEYE_STATION_NAME = Чавдар 13
5. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
6. Actions → **Update Deye dashboard** → **Run workflow** на основній гілці.
7. Після успішного виконання посилання на сайт буде в результатах Publish і Settings → Pages. Очікувана адреса: https://sergeymaximenko.github.io/C13PowerDashboard/

Код тут підготовлений; створення репозиторію, введення Secrets і перша публікація — окремі дії. Не вставляйте секрети у YAML, HTML, JavaScript або повідомлення чату.

## Як оновлюється сайт

GitHub запускає завдання кожні 5 хвилин (із зсувом від початку години), а також вручну й після push у main/master, якщо це основна гілка. Node.js отримує дані Deye і готує dist/data/status.json. Публікується тільки dist через Pages artifact, без комітів кожного вимірювання.

Браузер перевіряє JSON щохвилини. Кеш обходиться параметром часу; початковий час вимірювання Deye зберігається. Після 15 хвилин без свіжого вимірювання інтерфейс показує невідомий стан.

Розклад GitHub може затримуватися або пропускатися; у публічному репозиторії він автоматично вимикається після 60 днів без активності. Якщо це сталося, увімкніть workflow в Actions. Це не сервіс з гарантованим інтервалом оновлення.

Якщо Deye або Secrets недоступні, нове розгортання не публікується. Попередній файл залишається на сайті, але його час не оновлюється й він буде позначений застарілим. У логах не друкуються відповіді авторизації. Показники та назва станції публічні; облікові дані та ID пристроїв не експортуються.

Власний журнал вимірювань не створюється. GitHub зберігає службову історію запусків/розгортань; artifact має мінімальний строк зберігання 1 день.

## Локально

Як і раніше: start.cmd → http://localhost:3131. Підключення береться з .local, GitHub не потрібен. Інтернет для Deye потрібен.

Для пробної збірки статичного сайту зі збереженим локальним підключенням:
    npm run build:pages:local

Результат — папка dist з index.html у її корені. Саме цю папку можна відкрити через Live Server для перевірки статичного режиму. Вона містить лише один знімок показників; для наступного знімка потрібно знову виконати збірку. Не відкривайте її через file://.

Основна сторінка залишається public/index.html. Не потрібно переносити її до кореня репозиторію: workflow сам готує корінь сайту у dist.

## Офіційна документація

- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
