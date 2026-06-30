import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react';
import App from './App';

const firePrimaryPointerEvent = (element, type, properties) => {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperties(
		event,
		Object.fromEntries(
			Object.entries(properties).map(([key, value]) => [
				key,
				{ configurable: true, value },
			])
		)
	);

	fireEvent(element, event);
};

test('renders the carousel demo', () => {
  const { getByRole } = render(<App />);
  expect(getByRole('heading', { name: /demo/i })).toBeInTheDocument();
});

test('selects a card when clicked', () => {
	const { container } = render(<App />);
	const carousel = container.querySelector('[data-swiping]');
	const card = within(carousel).getByRole('button', { name: /city at blue hour/i });

  fireEvent.click(card);

	expect(card).toHaveAttribute('aria-pressed', 'true');
});

test('does not capture the pointer before a horizontal drag starts', () => {
	const { container } = render(<App />);
	const carousel = container.querySelector('[data-swiping]');
	const swipeable = carousel.firstElementChild;
	const card = within(carousel).getByRole('button', { name: /city at blue hour/i });
	swipeable.setPointerCapture = jest.fn();

	firePrimaryPointerEvent(card, 'pointerdown', {
		button: 0,
		clientX: 200,
		clientY: 20,
		isPrimary: true,
		pointerId: 1,
	});
	firePrimaryPointerEvent(card, 'pointerup', {
		clientX: 200,
		clientY: 20,
		pointerId: 1,
	});
	fireEvent.click(card);

	expect(swipeable.setPointerCapture).not.toHaveBeenCalled();
	expect(card).toHaveAttribute('aria-pressed', 'true');
});

test('does not keep suppressing card clicks after a drag suppression window', () => {
	jest.useFakeTimers();
	try {
		const { container } = render(<App />);
		const carousel = container.querySelector('[data-swiping]');
		const swipeable = carousel.firstElementChild;
		const card = within(carousel).getByRole('button', { name: /city at blue hour/i });
		swipeable.setPointerCapture = jest.fn();

		firePrimaryPointerEvent(card, 'pointerdown', {
			button: 0,
			clientX: 200,
			clientY: 20,
			isPrimary: true,
			pointerId: 1,
		});
		act(() => {
			jest.advanceTimersByTime(1000);
		});
		firePrimaryPointerEvent(card, 'pointermove', {
			clientX: 191,
			clientY: 20,
			pointerId: 1,
		});
		firePrimaryPointerEvent(card, 'pointerup', {
			clientX: 191,
			clientY: 20,
			pointerId: 1,
		});
		act(() => {
			jest.advanceTimersByTime(251);
		});

		fireEvent.click(card);

		expect(card).toHaveAttribute('aria-pressed', 'true');
	} finally {
		jest.useRealTimers();
	}
});

test('renders a bounded carousel window instead of repeated full data sets', () => {
	Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
	const { container } = render(<App />);
	const carousel = container.querySelector('[data-swiping]');

	// 1024px 下只需五張可視卡片與左右緩衝，不會依資料筆數倍增整個 DOM。
	expect(carousel.querySelectorAll('button')).toHaveLength(9);
});
