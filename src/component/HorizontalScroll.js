import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import styled from "styled-components";

// 預設滑動過場秒數
const showcaseSwipeTransitionSeconds = 0.6;
// 移動未超過 8px 不算拖曳，避免點擊抖動誤判
const dragStartThreshold = 8;
// 拖曳結束後只在短時間內攔截瀏覽器自動補發的 click。
const dragClickSuppressionMilliseconds = 250;
// 甩動速度門檻，單位 px/ms；距離短但夠快仍會換卡
const flingVelocityThreshold = 0.45;
// 額外渲染在可視範圍兩側的卡片數量，供滑動時作為緩衝。
const virtualItemBuffer = 2;
// 示範用資料筆數，用於驗證虛擬渲染不會隨資料量增加 DOM。
const demoItemCount = 100;
// 單張卡片允許的最大寬度。
const maximumItemWidth = 320;
// 相鄰卡片之間的間距。
const showcaseItemGap = 12;
// 輪播容器左右兩端保留的間距。
const showcaseContainerGap = 12;
// 行動裝置上要露出的相鄰卡片寬度。
const mobileSidePeek = 24;
// 將數值限制在指定的最小值與最大值之間。
const clamp = (value, minimum, maximum) =>
	Math.min(Math.max(value, minimum), maximum);
// 輪播使用的影片卡片資料。
const galleryImages = [
	{ name: "Mountain sunrise", image: "/images/mountain.jpg" },
	{ name: "City at blue hour", image: "/images/city.jpg" },
	{ name: "Forest waterfall", image: "/images/forest.jpg" },
	{ name: "Ocean wave", image: "/images/ocean.jpg" },
	{ name: "Desert expedition", image: "/images/desert.jpg" },
	{ name: "Alpine lake", image: "/images/alpine-lake.png" },
	{ name: "Green river valley", image: "/images/green-valley.png" },
	{ name: "Red sandstone canyon", image: "/images/red-canyon.png" },
	{ name: "Coastal lighthouse", image: "/images/coastal-lighthouse.png" },
	{ name: "Lavender field", image: "/images/lavender-field.png" },
	{ name: "Autumn forest path", image: "/images/autumn-path.png" },
	{ name: "Winter cabin", image: "/images/winter-cabin.png" },
];

// 以 12 張示範圖片組成 100 筆唯一項目，避免圖片檔案數量干擾虛擬化驗證。
const initialVideos = Array.from({ length: demoItemCount }, (_, index) => {
	const image = galleryImages[index % galleryImages.length];
	return { ...image, index: index + 1, name: `${image.name} #${index + 1}` };
});

// 將任意索引轉為資料陣列範圍內的循環索引。
const getCircularIndex = (index, itemCount) =>
	((index % itemCount) + itemCount) % itemCount;

// 由容器寬度推導幾何資料與視窗大小；virtualItemCount 與資料總數無關。
const getGalleryLayout = (containerWidth) => {
	// 卡片寬度會填滿窄螢幕，同時不超過桌面版上限。
	const itemWidth = Math.min(
		maximumItemWidth,
		Math.max(1, containerWidth - mobileSidePeek * 2)
	);
	// 每次輪播切換所需移動的一張卡片加間距。
	const itemStep = itemWidth + showcaseItemGap;
	// 目前容器中可見的卡片數量，額外加一張處理部分露出的卡片。
	const visibleItemCount = Math.ceil(containerWidth / itemStep) + 1;
	// 供渲染的總卡片數，包含可視卡片兩側的緩衝區。
	const virtualItemCount = visibleItemCount + virtualItemBuffer * 2;
	// 虛擬卡片列的完整寬度，包含卡片、間距和兩端留白。
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
			<CardIndex aria-hidden="true">
				#{value.index} / {demoItemCount}
			</CardIndex>
		</VideoCard>
	);
}

function Swipeable({ children, onSwipeStart, onSwiping, onSwipeEnd }) {
	// Pointer 事件高頻觸發時仍保留最新 callback，避免手勢監聽器因 props 更新而重建。
	const callbacksRef = useRef({ onSwipeStart, onSwiping, onSwipeEnd });
	// 目前受元件追蹤的 Pointer ID；null 表示沒有進行中的手勢。
	const pointerId = useRef(null);
	// 手勢起點的水平座標。
	const startX = useRef(0);
	// 手勢起點的垂直座標，用於辨識水平與垂直手勢。
	const startY = useRef(0);
	// 手勢目前或最後一次的水平座標。
	const endX = useRef(0);
	// 手勢開始的時間戳，用來計算滑動速度。
	const startTime = useRef(0);
	// 是否已超過拖曳門檻並開始觸發輪播滑動。
	const isDragging = useRef(false);
	// 已判定的手勢方向軸：pending、horizontal 或 vertical。
	const gestureAxis = useRef(null);
	// 拖曳結束後需要攔截 click 的截止時間，避免狀態殘留吃掉後續正常點擊。
	const suppressClickUntil = useRef(0);

	callbacksRef.current = { onSwipeStart, onSwiping, onSwipeEnd };

	const finishSwipe = useCallback(({ cancelled = false } = {}) => {
		if (pointerId.current === null) return;

		// 水平位移量，正值向右、負值向左。
		const deltaX = endX.current - startX.current;
		// 手勢經過時間，至少為 1ms 以避免除以零。
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
		suppressClickUntil.current = didDrag
			? Date.now() + dragClickSuppressionMilliseconds
			: 0;

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
			if (event.currentTarget.setPointerCapture) {
				event.currentTarget.setPointerCapture(event.pointerId);
			}
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
		if (Date.now() > suppressClickUntil.current) {
			suppressClickUntil.current = 0;
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		suppressClickUntil.current = 0;
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
	// 使用者目前是否正在以拖曳手勢操作輪播。
	const [isSwiping, setIsSwiping] = useState(false);
	// 卡片位移是否要套用 CSS 過場動畫。
	const [hasTransition, setHasTransition] = useState(false);
	// 目前過場動畫的持續秒數。
	const [transitionDuration, setTransitionDuration] = useState(
		showcaseSwipeTransitionSeconds
	);
	// 使用者拖曳或吸附動畫造成的水平位移量。
	const [deltaX, setDeltaX] = useState(0);
	// 目前被選取卡片的影片名稱。
	const [selectedVideo, setSelectedVideo] = useState(initialVideos[0].name);
	// 位於輪播中央的資料索引，允許超出陣列範圍以實作循環。
	const [activeIndex, setActiveIndex] = useState(0);
	// 依容器尺寸計算出的卡片大小、步距與虛擬視窗資訊。
	const [galleryLayout, setGalleryLayout] = useState(() =>
		getGalleryLayout(window.innerWidth)
	);
	// 輪播外層容器，用於取得實際寬度並監看尺寸變化。
	const showcaseRef = useRef(null);
	// 最近一次排程的動畫影格 ID，用於合併高頻拖曳更新。
	const frameId = useRef(null);
	// 吸附動畫完成後提交索引變更的計時器 ID。
	const transitionTimer = useRef(null);
	// 正在進行的輪播切換方向，待動畫完成後才實際更新索引。
	const pendingDirection = useRef(null);

	const scheduleDeltaX = useCallback((nextDeltaX) => {
		// 將高頻 pointermove 壓到每個繪製影格最多一次 React state 更新。
		cancelAnimationFrame(frameId.current);
		frameId.current = requestAnimationFrame(() => setDeltaX(nextDeltaX));
	}, []);

	const commitPendingRotation = useCallback(() => {
		// 讀取過場動畫結束後要套用的方向。
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
			// 依甩動速度縮短切換動畫；未達門檻時使用固定回彈時間。
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

			// 吸附到相鄰卡片所需的最終位移。
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
		// 由新寬度計算版面，僅在寬度真的改變時才更新 state。
		const updateGalleryLayout = (width) => {
			const nextLayout = getGalleryLayout(width);
			setGalleryLayout((currentLayout) =>
				currentLayout.containerWidth === nextLayout.containerWidth
					? currentLayout
					: nextLayout
			);
		};
		// 優先使用輪播容器的實際寬度，尚未掛載時才使用視窗寬度。
		const getContainerWidth = () =>
			showcaseRef.current?.getBoundingClientRect().width || window.innerWidth;
		// 將目前容器寬度同步到輪播版面資料。
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

	// 虛擬卡片視窗的中央位置，對應目前的 activeIndex。
	const centerVirtualIndex = Math.floor(galleryLayout.virtualItemCount / 2);
	// 僅保留可視卡片與左右緩衝區；資料再多也不會讓輪播 DOM 線性成長。
	const virtualVideos = Array.from(
		{ length: galleryLayout.virtualItemCount },
		(_, virtualIndex) => {
			// 虛擬視窗位置映射到可正可負的邏輯資料索引。
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
			<CarouselStatus>
				資料集：{initialVideos.length} 筆／目前渲染：{galleryLayout.virtualItemCount} 張卡片
			</CarouselStatus>
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

const CarouselStatus = styled.p`
	margin: 8px 0 0;
	color: #475569;
	font-size: 0.875rem;
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
	position: relative;
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

const CardIndex = styled.span`
	position: absolute;
	right: 8px;
	bottom: 8px;
	padding: 3px 7px;
	border-radius: 999px;
	background: rgb(15 23 42 / 80%);
	color: #fff;
	font-size: 0.75rem;
	font-weight: 600;
	line-height: 1.2;
	pointer-events: none;
`;

export default HorizontalScroll;
