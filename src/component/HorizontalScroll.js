import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import styled from "styled-components";

// 互動參數集中在此，方便依手感統一調整。
const showcaseSwipeTransitionSeconds = 0.6;
const dragStartThreshold = 8;
const flingVelocityThreshold = 0.45;
const virtualItemBuffer = 2;
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
	{ name: "Alpine lake", image: "/images/alpine-lake.png" },
	{ name: "Green river valley", image: "/images/green-valley.png" },
	{ name: "Red sandstone canyon", image: "/images/red-canyon.png" },
];

const getCircularIndex = (index, itemCount) =>
	((index % itemCount) + itemCount) % itemCount;

// 由容器寬度推導幾何資料與視窗大小；virtualItemCount 與資料總數無關。
const getGalleryLayout = (containerWidth) => {
	const itemWidth = Math.min(
		maximumItemWidth,
		Math.max(1, containerWidth - mobileSidePeek * 2)
	);
	const itemStep = itemWidth + showcaseItemGap;
	const visibleItemCount = Math.ceil(containerWidth / itemStep) + 1;
	const virtualItemCount = visibleItemCount + virtualItemBuffer * 2;
	const listingWidth =
		virtualItemCount * itemWidth +
		(virtualItemCount - 1) * showcaseItemGap +
		showcaseContainerGap * 2;

	return {
		containerWidth,
		itemHeight: itemWidth * 0.625,
		itemStep,
		itemWidth,
		listingWidth,
		virtualItemCount,
	};
};

function VideoElement({ dimensions, isBuffer = false, isSelected, onSelect, value }) {
	return (
		<VideoCard
			$height={dimensions.itemHeight}
			$width={dimensions.itemWidth}
			// 緩衝卡片只讓拖曳期間不露白，不納入鍵盤與輔具的可操作範圍。
			aria-hidden={isBuffer}
			aria-pressed={isSelected}
			onClick={() => onSelect(value.name)}
			selected={isSelected}
			tabIndex={isBuffer ? -1 : undefined}
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
	// Pointer 事件高頻觸發時仍保留最新 callback，避免手勢監聽器因 props 更新而重建。
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
		// px/ms：距離不足時仍可讓快速甩動換到下一張。
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
			// 先越過死區再判斷軸向，避免點擊時的微小抖動被當成滑動。
			if (
				Math.max(Math.abs(deltaX), Math.abs(deltaY)) < dragStartThreshold
			) {
				return;
			}
			gestureAxis.current =
				Math.abs(deltaX) >= Math.abs(deltaY) ? "horizontal" : "vertical";
		}

		// 保留垂直手勢給頁面捲動。
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

			// 快速甩動時最後一次 pointermove 可能遺失，因此以放開座標作為最終位置。
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
		// 拖曳結束會接著觸發 click；攔截它以免意外選取卡片。
		if (!suppressClick.current) return;

		event.preventDefault();
		event.stopPropagation();
		suppressClick.current = false;
	}, []);

	// 元件卸載時一併結束仍被 capture 的手勢，避免保留過期狀態。
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
	const [selectedVideo, setSelectedVideo] = useState(initialVideos[0].name);
	const [activeIndex, setActiveIndex] = useState(0);
	const [galleryLayout, setGalleryLayout] = useState(() =>
		getGalleryLayout(window.innerWidth)
	);
	const showcaseRef = useRef(null);
	const frameId = useRef(null);
	const transitionTimer = useRef(null);
	const pendingDirection = useRef(null);

	const scheduleDeltaX = useCallback((nextDeltaX) => {
		// 將高頻 pointermove 壓到每個繪製影格最多一次 React state 更新。
		cancelAnimationFrame(frameId.current);
		frameId.current = requestAnimationFrame(() => setDeltaX(nextDeltaX));
	}, []);

	const commitPendingRotation = useCallback(() => {
		const direction = pendingDirection.current;
		if (!direction) return false;

		cancelAnimationFrame(frameId.current);
		clearTimeout(transitionTimer.current);
		pendingDirection.current = null;
		// 動畫走完才變更邏輯索引並把位移歸零；下一個虛擬視窗會無縫地取代舊視窗。
		setActiveIndex((index) =>
			getCircularIndex(index + (direction === "left" ? 1 : -1), initialVideos.length)
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
		// 若上一段過場尚未完成，先提交其索引變更，避免連續滑動造成狀態不同步。
		commitPendingRotation();
		cancelAnimationFrame(frameId.current);
		clearTimeout(transitionTimer.current);
		setHasTransition(false);
		setTransitionDuration(showcaseSwipeTransitionSeconds);
		setIsSwiping(true);
	}, [commitPendingRotation]);

	const handleSwiping = useCallback(
		({ deltaX }) => {
			// 一次手勢最多預覽相鄰的一張，維持單步輪播的操作預期。
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

			// 位移達四分之一張，或速度達門檻，就提交到相鄰項目；否則彈回原位。
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
		// 尺寸須在繪製前同步更新，避免調整容器大小時先以舊寬度閃現一幀。
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
		// ResizeObserver 能偵測非視窗造成的容器變更；舊瀏覽器則退回 window resize。
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

	const centerVirtualIndex = Math.floor(galleryLayout.virtualItemCount / 2);
	// 僅保留可視卡片與左右緩衝區；資料再多也不會讓輪播 DOM 線性成長。
	const virtualVideos = Array.from(
		{ length: galleryLayout.virtualItemCount },
		(_, virtualIndex) => {
			const logicalIndex = activeIndex + virtualIndex - centerVirtualIndex;
			return {
				isBuffer:
					virtualIndex < virtualItemBuffer ||
					virtualIndex >= galleryLayout.virtualItemCount - virtualItemBuffer,
				logicalIndex,
				video: initialVideos[
					getCircularIndex(logicalIndex, initialVideos.length)
				],
			};
		}
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
					listingWidth={galleryLayout.listingWidth}
					transitionDuration={transitionDuration}
				>
					{virtualVideos.map(({ isBuffer, logicalIndex, video }) => (
						<VideoElement
							dimensions={galleryLayout}
							isBuffer={isBuffer}
							isSelected={selectedVideo === video.name}
							key={logicalIndex}
							onSelect={setSelectedVideo}
							value={video}
						/>
					))}
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
		transitionDuration,
	}) => ({
		style: {
			transform: `translate3d(calc(-${listingWidth / 2}px + ${deltaX}px), 0, 0)`,
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
