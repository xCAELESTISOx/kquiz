// Placeholder "Today" screen: real queues arrive with the API in stage 1–2.
export function App() {
  return (
    <main className="app">
      <header>
        <h1 className="title">오늘</h1>
        <p className="muted">Сегодня</p>
      </header>

      <section className="card">
        <p className="muted">К повторению</p>
        <p className="stat">0</p>
      </section>

      <section className="card">
        <p className="muted">Произношение</p>
        <p className="stat">0</p>
      </section>

      <nav className="actions">
        <button className="button primary" type="button">
          Повторить
        </button>
        <button className="button" type="button">
          Тренировать произношение
        </button>
        <button className="button" type="button">
          + Добавить карточку
        </button>
      </nav>
    </main>
  );
}
