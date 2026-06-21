import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import styled from "styled-components";

const showcaseSwipeTransitionSeconds = 0.6;
const dragStartThreshold = 8;
const flingVelocityThreshold = 0.45;
const itemAmount = 5;
const maximumItemWidth = 320;
const showcaseItemGap = 12;
const showcaseContainerGap = 12;
const mobileSidePeek = 24;
const clamp = (value, minimum, maximum) =>
	Math.min(Math.max(value, minimum), maximum);
const initialVideos = [
	{ name: "Mountain sunrise", image: "/images/mountain.jpg" },
	{ name: "City at blue hour", image: "/images/city.jpg" },
	{ name: "Forest waterfall", image: "/images/forest.jpg" },
	{ name: "Ocean wave", image: "/images/ocean.jpg" },
	{ name: "Desert expedition", image: "/images/desert.jpg" },
];

const getGalleryLayout = (containerWidth) => {
	const itemWidth = Math.min(
		maximumItemWidth,
		Math.max(1, containerWidth - mobileSidePeek * 2)
	);
	const listingWidth =
		itemAmount * itemWidth +
		(itemAmount - 1) * showcaseItemGap +
		showcaseContainerGap * 2;
	const sequenceWidth = itemAmount * (itemWidth + showcaseItemGap);

	return {
		containerWidth,
		itemHeight: itemWidth * 0.625,
		itemStep: itemWidth + showcaseItemGap,
		itemWidth,
		listingWidth,
		loopCopiesPerSide:
			Math.ceil(containerWidth / (listingWidth * 2)) + 1,
		sequenceWidth,
	};
};

function VideoElement({ dimensions, isClone = false, isSelected, onSelect, value }) {
	return (
		<VideoCard
			$height={dimensions.itemHeight}
			$width={dimensions.itemWidth}
			aria-hidden={isClone}
			aria-pressed={isSelected}
			onClick={() => onSelect(value.name)}
			selected={isSelected}
			tabIndex={isClone ? -1 : undefined}
			type="button"
		>
			<CardImage
				alt={value.name}
				draggable="false"
				height={dimensions.itemHeight}
				src={value.image}
				width={dimensions.itemWidth}
			/>
		</VideoCard>
	);
}

function Swipeable({ children, onSwipeStart, onSwiping, onSwipeEnd }) {
	const callbacksRef = useRef({ onSwipeStart, onSwiping, onSwipeEnd });
	const pointerId = useRef(null);
	const startX = useRef(0);
	const startY = useRef(0);
	const endX = useRef(0);
	const startTime = useRef(0);
	const isDragging = useRef(false);
	const gestureAxis = useRef(null);
	const suppressClick = useRef(false);

	callbacksRef.current = { onSwipeStart, onSwiping, onSwipeEnd };

	const finishSwipe = useCallback(({ cancelled = false } = {}) => {
		if (pointerId.current === null) return;

		const deltaX = endX.current - startX.current;
		const elapsed = Math.max(Date.now() - startTime.current, 1);
		const velocityX = Math.abs(deltaX) / elapsed;
		const didDrag = isDragging.current;

		pointerId.current = null;
		startX.current = 0;
		startY.current = 0;
		endX.current = 0;
		startTime.current = 0;
		isDragging.current = false;
		gestureAxis.current = null;
		suppressClick.current = didDrag;

		if (didDrag) {
			callbacksRef.current.onSwipeEnd({
				cancelled,
				deltaX,
				velocityX,
				direction: deltaX < 0 ? "left" : "right",
			});
		}
	}, []);

	const handlePointerDown = useCallback((event) => {
		if (!event.isPrimary || event.button > 0) return;

		pointerId.current = event.pointerId;
		startX.current = event.clientX;
		startY.current = event.clientY;
		endX.current = event.clientX;
		startTime.current = Date.now();
		gestureAxis.current = "pending";
		if (event.currentTarget.setPointerCapture) {
			event.currentTarget.setPointerCapture(event.pointerId);
		}
	}, []);

	const handlePointerMove = useCallback((event) => {
		if (event.pointerId !== pointerId.current) return;

		endX.current = event.clientX;
		const deltaX = endX.current - startX.current;
		const deltaY = event.clientY - startY.current;

		if (gestureAxis.current === "pending") {
			if (
				Math.max(Math.abs(deltaX), Math.abs(deltaY)) < dragStartThreshold
			) {
				return;
			}
			gestureAxis.current =
				Math.abs(deltaX) >= Math.abs(deltaY) ? "horizontal" : "vertical";
		}

		if (gestureAxis.current !== "horizontal") return;

		if (!isDragging.current) {
			isDragging.current = true;
			callbacksRef.current.onSwipeStart();
		}

		const elapsed = Math.max(Date.now() - startTime.current, 1);
		callbacksRef.current.onSwiping({
			deltaX,
			velocityX: Math.abs(deltaX) / elapsed,
			direction: deltaX < 0 ? "left" : "right",
		});
	}, []);

	const handlePointerUp = useCallback(
		(event) => {
			if (event.pointerId !== pointerId.current) return;

			// The last pointermove can be skipped during a fast fling, so the
			// release coordinate must be recorded before deriving the swipe.
			endX.current = event.clientX;
			finishSwipe();
		},
		[finishSwipe]
	);

	const handlePointerCancel = useCallback(
		(event) => {
			if (event.pointerId === pointerId.current) {
				finishSwipe({ cancelled: true });
			}
		},
		[finishSwipe]
	);

	const handleClickCapture = useCallback((event) => {
		if (!suppressClick.current) return;

		event.preventDefault();
		event.stopPropagation();
		suppressClick.current = false;
	}, []);

	useEffect(() => finishSwipe, [finishSwipe]);

	return (
		<StyledSwipeable
			aria-label="Image carousel"
			onClickCapture={handleClickCapture}
			onPointerCancel={handlePointerCancel}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
		>
			{children}
		</StyledSwipeable>
	);
}

function HorizontalScroll() {
	const [isSwiping, setIsSwiping] = useState(false);
	const [hasTransition, setHasTransition] = useState(false);
	const [transitionDuration, setTransitionDuration] = useState(
		showcaseSwipeTransitionSeconds
	);
	const [deltaX, setDeltaX] = useState(0);
	const [videoList, setVideoList] = useState(initialVideos);
	const [selectedVideo, setSelectedVideo] = useState(initialVideos[0].name);
	const [galleryLayout, setGalleryLayout] = useState(() =>
		getGalleryLayout(window.innerWidth)
	);
	const showcaseRef = useRef(null);
	const frameId = useRef(null);
	const transitionTimer = useRef(null);
	const pendingDirection = useRef(null);

	const scheduleDeltaX = useCallback((nextDeltaX) => {
		cancelAnimationFrame(frameId.current);
		frameId.current = requestAnimationFrame(() => setDeltaX(nextDeltaX));
	}, []);

	const commitPendingRotation = useCallback(() => {
		const direction = pendingDirection.current;
		if (!direction) return false;

		cancelAnimationFrame(frameId.current);
		clearTimeout(transitionTimer.current);
		pendingDirection.current = null;
		setVideoList((videos) =>
			direction === "left"
				? [...videos.slice(1), videos[0]]
				: [videos[videos.length - 1], ...videos.slice(0, -1)]
		);
		setDeltaX(0);
		setHasTransition(false);
		return true;
	}, []);

	const clearPendingTransition = useCallback(() => {
		cancelAnimationFrame(frameId.current);
		clearTimeout(transitionTimer.current);
		pendingDirection.current = null;
	}, []);

	const handleSwipeStart = useCallback(() => {
		commitPendingRotation();
		cancelAnimationFrame(frameId.current);
		clearTimeout(transitionTimer.current);
		setHasTransition(false);
		setTransitionDuration(showcaseSwipeTransitionSeconds);
		setIsSwiping(true);
	}, [commitPendingRotation]);

	const handleSwiping = useCallback(
		({ deltaX }) => {
			scheduleDeltaX(
				clamp(deltaX, -galleryLayout.itemStep, galleryLayout.itemStep)
			);
		},
		[galleryLayout.itemStep, scheduleDeltaX]
	);

	const handleSwipeEnd = useCallback(
		({ cancelled = false, deltaX, direction, velocityX }) => {
			if (cancelled) {
				setIsSwiping(false);
				setHasTransition(true);
				setTransitionDuration(0.18);
				scheduleDeltaX(0);
				transitionTimer.current = setTimeout(
					() => setHasTransition(false),
					180
				);
				return;
			}

			const shouldChangeItem =
				Math.abs(deltaX) >= galleryLayout.itemStep * 0.25 ||
				velocityX >= flingVelocityThreshold;
			const snapDuration = shouldChangeItem
				? Math.max(0.18, 0.42 - velocityX * 0.18)
				: 0.24;
			setIsSwiping(false);
			setHasTransition(true);
			setTransitionDuration(snapDuration);

			if (!shouldChangeItem) {
				scheduleDeltaX(0);
				transitionTimer.current = setTimeout(
					() => setHasTransition(false),
					snapDuration * 1000
				);
				return;
			}

			const nextDeltaX =
				direction === "left"
					? -galleryLayout.itemStep
					: galleryLayout.itemStep;
			scheduleDeltaX(nextDeltaX);
			pendingDirection.current = direction;
			transitionTimer.current = setTimeout(
				commitPendingRotation,
				snapDuration * 1000
			);
		},
		[commitPendingRotation, galleryLayout.itemStep, scheduleDeltaX]
	);

	useEffect(() => clearPendingTransition, [clearPendingTransition]);

	useLayoutEffect(() => {
		const updateGalleryLayout = (width) => {
			const nextLayout = getGalleryLayout(width);
			setGalleryLayout((currentLayout) =>
				currentLayout.containerWidth === nextLayout.containerWidth
					? currentLayout
					: nextLayout
			);
		};
		const getContainerWidth = () =>
			showcaseRef.current?.getBoundingClientRect().width || window.innerWidth;
		const updateFromContainer = () => updateGalleryLayout(getContainerWidth());

		updateFromContainer();
		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", updateFromContainer);
			return () => window.removeEventListener("resize", updateFromContainer);
		}

		const resizeObserver = new ResizeObserver(([entry]) => {
			updateGalleryLayout(entry.contentRect.width);
		});
		resizeObserver.observe(showcaseRef.current);
		return () => resizeObserver.disconnect();
	}, []);

	const loopedVideos = Array.from(
		{ length: galleryLayout.loopCopiesPerSide * 2 + 1 },
		(_, copyIndex) => ({
			copyIndex,
			videos: videoList,
		})
	);

	return (
		<StyledHomeShowcaseList data-swiping={isSwiping} ref={showcaseRef}>
			<Swipeable
				onSwipeEnd={handleSwipeEnd}
				onSwipeStart={handleSwipeStart}
				onSwiping={handleSwiping}
			>
				<ShowcaseList
					deltaX={deltaX}
					hasTransition={hasTransition}
					loopOffset={
						galleryLayout.loopCopiesPerSide * galleryLayout.sequenceWidth
					}
					listingWidth={galleryLayout.listingWidth}
					transitionDuration={transitionDuration}
				>
					{loopedVideos.flatMap(({ copyIndex, videos }) =>
						videos.map((video) => (
							<VideoElement
								dimensions={galleryLayout}
								isClone={copyIndex !== galleryLayout.loopCopiesPerSide}
								isSelected={selectedVideo === video.name}
								key={`${copyIndex}-${video.name}`}
								onSelect={setSelectedVideo}
								value={video}
							/>
						))
					)}
				</ShowcaseList>
			</Swipeable>
		</StyledHomeShowcaseList>
	);
}

const StyledHomeShowcaseList = styled.div`
	position: relative;
	margin-bottom: 16px;
	overflow: hidden;
`;

const StyledSwipeable = styled.div`
	width: 100%;
	touch-action: pan-y;
	user-select: none;
`;

const ShowcaseList = styled.div.attrs(
	({
		deltaX = 0,
		hasTransition = false,
		listingWidth,
		loopOffset,
		transitionDuration,
	}) => ({
		style: {
			transform: `translate3d(calc(-${loopOffset + listingWidth / 2}px + ${deltaX}px), 0, 0)`,
		transition: `transform ${hasTransition ? transitionDuration : 0}s cubic-bezier(0.22, 0.61, 0.36, 1)`,
		width: `${listingWidth}px`,
	},
	})
)`
	position: relative;
	left: 50%;
	display: flex;
	flex-wrap: nowrap;
	will-change: transform;

	&::before,
	&::after {
		content: "";
		width: ${showcaseContainerGap / 2}px;
		flex: none;
	}
`;

const VideoCard = styled.button`
	box-sizing: border-box;
	width: ${({ $width }) => $width}px;
	height: ${({ $height }) => $height}px;
	padding: 0;
	margin: 0 6px;
	flex: none;
	overflow: hidden;
	border: 3px solid ${({ selected }) => (selected ? "#2563eb" : "transparent")};
	border-radius: 10px;
	background: transparent;
	cursor: pointer;
	transition: border-color 150ms ease, transform 150ms ease;

	&:focus-visible {
		outline: 3px solid #93c5fd;
		outline-offset: 3px;
	}

	&:hover {
		transform: translateY(-2px);
	}
`;

const CardImage = styled.img`
	display: block;
	width: 100%;
	height: 100%;
	object-fit: cover;
	pointer-events: none;
`;

export default HorizontalScroll;
