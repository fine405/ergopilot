document.querySelectorAll('.quiz-card').forEach((card) => {
  const correct = card.dataset.correct;
  const explanation = card.dataset.explanation ?? '';
  const feedback = card.querySelector('.quiz-feedback');

  card.querySelectorAll('.quiz-option').forEach((button) => {
    button.addEventListener('click', () => {
      card.querySelectorAll('.quiz-option').forEach((item) => {
        item.classList.remove('correct', 'wrong');
        item.disabled = false;
      });

      const isCorrect = button.dataset.answer === correct;
      button.classList.add(isCorrect ? 'correct' : 'wrong');

      if (!isCorrect) {
        const target = card.querySelector(`[data-answer="${correct}"]`);
        target?.classList.add('correct');
      }

      feedback.textContent = `${isCorrect ? '正确。' : '再看一眼职责边界。'} ${explanation}`;
    });
  });
});
