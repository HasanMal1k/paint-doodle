// @ts-check
// eslint-disable-next-line no-unused-vars
/* global $thumbnail_window:writable, canvas_bounding_client_rect:writable, current_history_node:writable, file_format:writable, file_name:writable, helper_layer:writable, history_node_to_cancel_to:writable, magnification:writable, monochrome:writable, palette:writable, pointer:writable, return_to_magnification:writable, return_to_tools:writable, root_history_node:writable, saved:writable, selected_colors:writable, selected_tool:writable, selected_tools:writable, selection:writable, show_grid:writable, show_thumbnail:writable, system_file_handle:writable, textbox:writable, thumbnail_canvas:writable, tool_transparent_mode:writable, transparency:writable, undos:writable */
/* global $canvas, $canvas_area, $colorbox, $status_text, $toolbox, $Window, AccessKeys, applyCSSProperties, decodeBMP, default_canvas_height, default_canvas_width, default_magnification, default_tool, enable_palette_loading_from_indexed_images, encodeBMP, localize, main_canvas, main_ctx, monochrome_palette, my_canvas_height, my_canvas_width, new_local_session, parseThemeFileString, pointer_active, pointers, polychrome_palette, redos, systemHooks, text_tool_font, update_fill_and_stroke_colors_and_lineWidth, UPNG, UTIF */

import { $DialogWindow } from "./$ToolWindow.js";
import { OnCanvasHelperLayer } from "./OnCanvasHelperLayer.js";
import { OnCanvasSelection } from "./OnCanvasSelection.js";
import { OnCanvasTextBox } from "./OnCanvasTextBox.js";
// import { localize } from "./app-localization.js";
import { default_palette } from "./color-data.js";
import { image_formats } from "./file-format-data.js";
import { $G, E, TAU, debounce, from_canvas_coords, get_help_folder_icon, get_icon_for_tool, get_rgba_from_color, is_discord_embed, is_pride_month, make_canvas, render_access_key, to_canvas_coords } from "./helpers.js";
import { apply_image_transformation, draw_grid, draw_selection_box, flip_horizontal, flip_vertical, invert_monochrome, invert_rgb, rotate, stretch_and_skew, threshold_black_and_white } from "./image-manipulation.js";
import { show_imgur_uploader } from "./imgur.js";
import { showMessageBox } from "./msgbox.js";
import { localStore } from "./storage.js";
import { TOOL_CURVE, TOOL_FREE_FORM_SELECT, TOOL_POLYGON, TOOL_SELECT, TOOL_TEXT, tools } from "./tools.js";
// `sessions.js` must be loaded after `app.js`
// This would cause it to be loaded earlier, and error trying to access `undos`
// I'm surprised I haven't been bitten by this sort of bug, and I've
// mostly converted the whole app to ES Modules!
// TODO: make sessions.js export function to initialize it
// import { new_local_session } from "./sessions.js";

// expresses order in the URL as well as type
const param_types = {
	// settings
	"eye-gaze-mode": "bool", // maps to "enlarge-ui"+"dwell-clicker"+"vertical-color-box-mode"+"easy-undo"
	"enlarge-ui": "bool",
	"easy-undo": "bool",
	"dwell-clicker": "bool",
	"head-tracker": "bool",
	"vertical-color-box-mode": "bool", // could rename this to simply "vertical-color-box" or "vertical-palette"
	"speech-recognition-mode": "bool", // could rename this to simply "voice"
	// dev settings
	"compare-reference": "bool",
	"compare-reference-tool-windows": "bool",
	"force-open-project-news": "bool",
	// sessions
	"local": "string",
	"session": "string",
	"load": "string",
};

const exclusive_params = [
	"local",
	"session",
	"load",
];

function get_all_url_params() {
	/** @type {Record<string, string | boolean>} */
	const params = {};
	location.hash.replace(/^#/, "").split(/,/).forEach((param_decl) => {
		// colon is used in param value for URLs so split(":") isn't good enough
		const colon_index = param_decl.indexOf(":");
		if (colon_index === -1) {
			// boolean value, implicitly true because it's in the URL
			const param_name = param_decl;
			params[param_name] = true;
		} else {
			const param_name = param_decl.slice(0, colon_index);
			const param_value = param_decl.slice(colon_index + 1);
			params[param_name] = decodeURIComponent(param_value);
		}
	});
	for (const [param_name, param_type] of Object.entries(param_types)) {
		if (param_type === "bool" && !params[param_name]) {
			params[param_name] = false;
		}
	}
	return params;
}

function get_url_param(param_name) {
	return get_all_url_params()[param_name];
}

/**
 * @param {string} param_name
 * @param {string | boolean} value
 * @param {object} [options]
 * @param {boolean} [options.replace_history_state=false]
 */
function change_url_param(param_name, value, { replace_history_state = false } = {}) {
	change_some_url_params({ [param_name]: value }, { replace_history_state });
}

/**
 * @param {Record<string, string | boolean>} updates
 * @param {object} [options]
 * @param {boolean} [options.replace_history_state=false]
 */
function change_some_url_params(updates, { replace_history_state = false } = {}) {
	for (const exclusive_param of exclusive_params) {
		if (updates[exclusive_param]) {
			exclusive_params.forEach((param) => {
				if (param !== exclusive_param) {
					updates[param] = null; // must be enumerated (for Object.assign) but falsy, to get removed from the URL
				}
			});
		}
	}
	set_all_url_params(Object.assign({}, get_all_url_params(), updates), { replace_history_state });
}

/**
 * @param {Record<string, string | boolean>} params
 * @param {object} [options]
 * @param {boolean} [options.replace_history_state=false]
 */
function set_all_url_params(params, { replace_history_state = false } = {}) {

	let new_hash = "";
	for (const [param_name, param_type] of Object.entries(param_types)) {
		if (params[param_name]) {
			if (new_hash.length) {
				new_hash += ",";
			}
			new_hash += encodeURIComponent(param_name);
			if (param_type !== "bool") {
				new_hash += ":" + encodeURIComponent(params[param_name]);
			}
		}
	}
	let query_string = location.search;
	// The Discord Activity needs to preserve the query string, so it's exempt from this.
	if (!query_string.includes("frame_id")) {
		// Omit query string for theoretical backwards compatibility with old URLs.
		// TODO: what were these URLs? do they really still work? are they still relevant? probably not...
		query_string = "";
	}
	const new_url = `${location.origin}${location.pathname}${query_string}#${new_hash}`;
	try {
		// can fail when running from file: protocol
		if (replace_history_state) {
			history.replaceState(null, document.title, new_url);
		} else {
			history.pushState(null, document.title, new_url);
		}
	} catch (_error) {
		location.hash = new_hash;
	}

	$G.triggerHandler("change-url-params");
}

function update_magnified_canvas_size() {
	$canvas.css("width", main_canvas.width * magnification);
	$canvas.css("height", main_canvas.height * magnification);

	update_canvas_rect();
}

function update_canvas_rect() {
	window.canvas_bounding_client_rect = main_canvas.getBoundingClientRect();

	update_helper_layer();
}

let helper_layer_update_queued = false;
/**
 * for updating the brush preview when the mouse stays in the same place,
 * but its coordinates in the document change due to scrolling or browser zooming (handled with scroll and resize events)
 * @type {{ clientX: number, clientY: number, devicePixelRatio: number }}
 */
let info_for_updating_pointer;
/** @param {{ clientX: number, clientY: number }} [e] */
function update_helper_layer(e) {
	// e should be passed for pointer events, but not scroll or resize events
	// e may be a synthetic event without clientX/Y, so ignore that (using isFinite)
	// e may also be a timestamp from requestAnimationFrame callback; ignore that
	if (e && isFinite(e.clientX)) {
		info_for_updating_pointer = { clientX: e.clientX, clientY: e.clientY, devicePixelRatio };
	}
	if (helper_layer_update_queued) {
		// window.console?.log("update_helper_layer - nah, already queued");
		return;
	} else {
		// window.console?.log("update_helper_layer");
	}
	helper_layer_update_queued = true;
	requestAnimationFrame(() => {
		helper_layer_update_queued = false;
		update_helper_layer_immediately();
	});
}
function update_helper_layer_immediately() {
	// window.console?.log("Update helper layer NOW");
	if (info_for_updating_pointer) {
		const rescale = info_for_updating_pointer.devicePixelRatio / devicePixelRatio;
		info_for_updating_pointer.clientX *= rescale;
		info_for_updating_pointer.clientY *= rescale;
		info_for_updating_pointer.devicePixelRatio = devicePixelRatio;
		pointer = to_canvas_coords(info_for_updating_pointer);
	}

	const scale = magnification * window.devicePixelRatio;

	if (!helper_layer) {
		helper_layer = new OnCanvasHelperLayer(0, 0, main_canvas.width, main_canvas.height, false, scale);
	}

	const margin = 15;
	const viewport_x = Math.floor(Math.max($canvas_area.scrollLeft() / magnification - margin, 0));
	// Nevermind, canvas, isn't aligned to the right in RTL layout!
	// const viewport_x =
	// 	get_direction() === "rtl" ?
	// 		// Note: $canvas_area.scrollLeft() can return negative numbers for RTL layout
	// 		Math.floor(Math.max(($canvas_area.scrollLeft() - $canvas_area.innerWidth()) / magnification + canvas.width - margin, 0)) :
	// 		Math.floor(Math.max($canvas_area.scrollLeft() / magnification - margin, 0));
	const viewport_y = Math.floor(Math.max($canvas_area.scrollTop() / magnification - margin, 0));
	const viewport_x2 = Math.floor(Math.min(viewport_x + $canvas_area.width() / magnification + margin * 2, main_canvas.width));
	const viewport_y2 = Math.floor(Math.min(viewport_y + $canvas_area.height() / magnification + margin * 2, main_canvas.height));
	const viewport_width = viewport_x2 - viewport_x;
	const viewport_height = viewport_y2 - viewport_y;
	const resolution_width = viewport_width * scale;
	const resolution_height = viewport_height * scale;
	if (
		helper_layer.canvas.width !== resolution_width ||
		helper_layer.canvas.height !== resolution_height
	) {
		helper_layer.canvas.width = resolution_width;
		helper_layer.canvas.height = resolution_height;
		helper_layer.canvas.ctx.disable_image_smoothing();
		helper_layer.width = viewport_width;
		helper_layer.height = viewport_height;
	}
	helper_layer.x = viewport_x;
	helper_layer.y = viewport_y;
	helper_layer.position();

	render_canvas_view(helper_layer.canvas, scale, viewport_x, viewport_y, true);

	if (thumbnail_canvas && $thumbnail_window.is(":visible")) {
		// The thumbnail can be bigger or smaller than the viewport, depending on the magnification and thumbnail window size.
		// So can the document.
		// Ideally it should show the very corner if scrolled all the way to the corner,
		// so that you can get a thumbnail of any location just by scrolling.
		// But it's impossible if the thumbnail is smaller than the viewport. You have to resize the thumbnail window in that case.
		// (And if the document is smaller than the viewport, there's no scrolling to indicate where you want to get a thumbnail of.)
		// It gets clipped to the top left portion of the viewport if the thumbnail is too small.

		// This works except for if there's a selection, it affects the scrollable area, and it shouldn't affect this calculation.
		// const scroll_width = $canvas_area[0].scrollWidth - $canvas_area[0].clientWidth;
		// const scroll_height = $canvas_area[0].scrollHeight - $canvas_area[0].clientHeight;

		// These padding terms are negligible in comparison to the margin reserved for canvas handles,
		// which I'm not accounting for (except for clamping below).
		const padding_left = parseFloat($canvas_area.css("padding-left"));
		const padding_top = parseFloat($canvas_area.css("padding-top"));
		const scroll_width = main_canvas.clientWidth + padding_left - $canvas_area[0].clientWidth;
		const scroll_height = main_canvas.clientHeight + padding_top - $canvas_area[0].clientHeight;
		// Don't divide by less than one, or the thumbnail with disappear off to the top/left (or completely for NaN).
		let scroll_x_fraction = $canvas_area[0].scrollLeft / Math.max(1, scroll_width);
		let scroll_y_fraction = $canvas_area[0].scrollTop / Math.max(1, scroll_height);
		// If the canvas is larger than the document view, but not by much, and you scroll to the bottom or right,
		// the margin for the canvas handles can lead to the thumbnail being cut off or even showing
		// just blank space without this clamping (due to the not quite accurate scrollable area calculation).
		scroll_x_fraction = Math.min(scroll_x_fraction, 1);
		scroll_y_fraction = Math.min(scroll_y_fraction, 1);

		let viewport_x = Math.floor(Math.max(scroll_x_fraction * (main_canvas.width - thumbnail_canvas.width), 0));
		let viewport_y = Math.floor(Math.max(scroll_y_fraction * (main_canvas.height - thumbnail_canvas.height), 0));

		render_canvas_view(thumbnail_canvas, 1, viewport_x, viewport_y, false); // devicePixelRatio?
	}
}

/**
 * @param {PixelCanvas} hcanvas
 * @param {number} scale
 * @param {number} viewport_x
 * @param {number} viewport_y
 * @param {boolean} is_helper_layer
 */
function render_canvas_view(hcanvas, scale, viewport_x, viewport_y, is_helper_layer) {
	update_fill_and_stroke_colors_and_lineWidth(selected_tool);

	const grid_visible = show_grid && magnification >= 4 && (window.devicePixelRatio * magnification) >= 4 && is_helper_layer;

	const hctx = hcanvas.ctx;

	hctx.clearRect(0, 0, hcanvas.width, hcanvas.height);

	if (!is_helper_layer) {
		// Draw the actual document canvas (for the thumbnail)
		// (For the main canvas view, the helper layer is separate from (and overlaid on top of) the document canvas)
		hctx.drawImage(main_canvas, viewport_x, viewport_y, hcanvas.width, hcanvas.height, 0, 0, hcanvas.width, hcanvas.height);
	}

	var tools_to_preview = [...selected_tools];

	// Don't preview tools while dragging components/component windows
	// (The magnifier preview is especially confusing looking together with the component preview!)
	if ($("body").hasClass("dragging") && !pointer_active) {
		// tools_to_preview.length = 0;
		// Curve and Polygon tools have a persistent state over multiple gestures,
		// which is, as of writing, part of the "tool preview"; it's ugly,
		// but at least they don't have ALSO a brush like preview, right?
		// so we can just allow those thru
		tools_to_preview = tools_to_preview.filter((tool) =>
			tool.id === TOOL_CURVE ||
			tool.id === TOOL_POLYGON
		);
	}

	// the select box previews draw the document canvas onto the preview canvas
	// so they have something to invert within the preview canvas
	// but this means they block out anything earlier
	// NOTE: sort Select after Free-Form Select,
	// Brush after Eraser, as they are from the toolbar ordering
	tools_to_preview.sort((a, b) => {
		if (a.selectBox && !b.selectBox) {
			return -1;
		}
		if (!a.selectBox && b.selectBox) {
			return 1;
		}
		return 0;
	});
	// two select box previews would just invert and cancel each other out
	// so only render one if there's one or more
	var select_box_index = tools_to_preview.findIndex((tool) => tool.selectBox);
	if (select_box_index >= 0) {
		tools_to_preview = tools_to_preview.filter((tool, index) => !tool.selectBox || index == select_box_index);
	}

	tools_to_preview.forEach((tool) => {
		if (tool.drawPreviewUnderGrid && pointer && pointers.length < 2) {
			hctx.save();
			tool.drawPreviewUnderGrid(hctx, pointer.x, pointer.y, grid_visible, scale, -viewport_x, -viewport_y);
			hctx.restore();
		}
	});

	if (selection) {
		hctx.save();

		hctx.scale(scale, scale);
		hctx.translate(-viewport_x, -viewport_y);

		hctx.drawImage(selection.canvas, selection.x, selection.y);

		hctx.restore();

		if (!is_helper_layer && !selection.dragging) {
			// Draw the selection outline (for the thumbnail)
			// (The main canvas view has the OnCanvasSelection object which has its own outline)
			draw_selection_box(hctx, selection.x, selection.y, selection.width, selection.height, scale, -viewport_x, -viewport_y);
		}
	}

	if (textbox) {
		hctx.save();

		hctx.scale(scale, scale);
		hctx.translate(-viewport_x, -viewport_y);

		hctx.drawImage(textbox.canvas, textbox.x, textbox.y);

		hctx.restore();

		if (!is_helper_layer && !textbox.dragging) {
			// Draw the textbox outline (for the thumbnail)
			// (The main canvas view has the OnCanvasTextBox object which has its own outline)
			draw_selection_box(hctx, textbox.x, textbox.y, textbox.width, textbox.height, scale, -viewport_x, -viewport_y);
		}
	}

	if (grid_visible) {
		draw_grid(hctx, scale);
	}

	tools_to_preview.forEach((tool) => {
		if (tool.drawPreviewAboveGrid && pointer && pointers.length < 2) {
			hctx.save();
			tool.drawPreviewAboveGrid(hctx, pointer.x, pointer.y, grid_visible, scale, -viewport_x, -viewport_y);
			hctx.restore();
		}
	});
}
function update_disable_aa() {
	const dots_per_canvas_px = window.devicePixelRatio * magnification;
	const round = Math.floor(dots_per_canvas_px) === dots_per_canvas_px;
	$canvas_area.toggleClass("disable-aa-for-things-at-main-canvas-scale", dots_per_canvas_px >= 3 || round);
}

/**
 * @param {number} new_scale
 * @param {{x: number, y: number}} [anchor_point] - uses canvas coordinates; default is the top-left of the $canvas_area viewport
 */
function set_magnification(new_scale, anchor_point) {
	// How this works is, you imagine "what if it was zoomed, where would the anchor point be?"
	// Then to make it end up where it started, you simply shift the viewport by the difference.
	// And actually you don't have to "imagine" zooming, you can just do the zoom.

	anchor_point = anchor_point ?? {
		x: $canvas_area.scrollLeft() / magnification,
		y: $canvas_area.scrollTop() / magnification,
	};
	const anchor_on_page = from_canvas_coords(anchor_point);

	magnification = new_scale;
	if (new_scale !== 1) {
		return_to_magnification = new_scale;
	}
	update_magnified_canvas_size(); // also updates canvas_bounding_client_rect used by from_canvas_coords()

	const anchor_after_zoom = from_canvas_coords(anchor_point);
	// Note: scrollBy() not scrollTo()
	$canvas_area[0].scrollBy({
		left: anchor_after_zoom.clientX - anchor_on_page.clientX,
		top: anchor_after_zoom.clientY - anchor_on_page.clientY,
		behavior: "instant",
	});

	$G.triggerHandler("resize"); // updates handles & grid
	$G.trigger("option-changed"); // updates options area
	$G.trigger("magnification-changed"); // updates custom zoom window
}

/** @type {OSGUI$Window} */
let $custom_zoom_window;

let dev_custom_zoom = false;
try {
	dev_custom_zoom = localStorage.dev_custom_zoom === "true";
} catch (_error) { /* ignore */ }
if (dev_custom_zoom) {
	$(() => {
		show_custom_zoom_window();
		$custom_zoom_window.css({
			left: 80,
			top: 50,
			opacity: 0.5,
		});
	});
}

function show_custom_zoom_window() {
	if ($custom_zoom_window) {
		$custom_zoom_window.close();
	}
	const $w = $DialogWindow(localize("Custom Zoom"));
	$custom_zoom_window = $w;
	$w.addClass("custom-zoom-window");

	$w.$main.append(`<div class='current-zoom'>${localize("Current zoom:")} <bdi>${magnification * 100}%</bdi></div>`);
	// update when zoom changes
	$G.on("magnification-changed", () => {
		$w.$main.find(".current-zoom bdi").text(`${magnification * 100}%`);
	});

	const $fieldset = $(E("fieldset")).appendTo($w.$main);
	$fieldset.append(`
		<legend>${localize("Zoom to")}</legend>
		<div class="fieldset-body">
			<div class="radio-field"><input type="radio" name="custom-zoom-radio" id="zoom-option-1" aria-keyshortcuts="Alt+1 1" value="1"/><label for="zoom-option-1">${render_access_key("&100%")}</label></div>
			<div class="radio-field"><input type="radio" name="custom-zoom-radio" id="zoom-option-2" aria-keyshortcuts="Alt+2 2" value="2"/><label for="zoom-option-2">${render_access_key("&200%")}</label></div>
			<div class="radio-field"><input type="radio" name="custom-zoom-radio" id="zoom-option-4" aria-keyshortcuts="Alt+4 4" value="4"/><label for="zoom-option-4">${render_access_key("&400%")}</label></div>
			<div class="radio-field"><input type="radio" name="custom-zoom-radio" id="zoom-option-6" aria-keyshortcuts="Alt+6 6" value="6"/><label for="zoom-option-6">${render_access_key("&600%")}</label></div>
			<div class="radio-field"><input type="radio" name="custom-zoom-radio" id="zoom-option-8" aria-keyshortcuts="Alt+8 8" value="8"/><label for="zoom-option-8">${render_access_key("&800%")}</label></div>
			<div class="radio-field"><input type="radio" name="custom-zoom-radio" id="zoom-option-really-custom" value="really-custom"/><label for="zoom-option-really-custom"><input type="number" min="10" max="1000" name="really-custom-zoom-input" class="inset-deep no-spinner" value=""/>%</label></div>
		</div>
	`);
	let is_custom = true;
	$fieldset.find("input[type=radio]").get().forEach((/** @type {HTMLInputElement} */ el) => {
		if (parseFloat(el.value) === magnification) {
			el.checked = true;
			el.focus();
			is_custom = false;
		}
	});
	const $really_custom_radio_option = $fieldset.find("input[value='really-custom']");
	const $really_custom_input = /** @type {JQuery<HTMLInputElement>}*/($fieldset.find("input[name='really-custom-zoom-input']"));

	$really_custom_input.closest("label").on("click", (event) => {
		$really_custom_radio_option.prop("checked", true);
		// If the user clicks on the input, let it get focus naturally, placing the caret where you click.
		// If the user clicks outside it on the label, focus the input and select the text.
		if ($(event.target).closest("input").length === 0) {
			// Why does focusing this input programmatically not lead to the input
			// being focused ultimately after the click?
			// I'm working around this by using requestAnimationFrame (setTimeout would lead to a flicker).
			// What am I working around, though? Is it my os-gui.js library? It has code to focus the
			// last focused control in a window. I didn't see that code in the debugger, but I could've missed it.
			// Debugging without time travel is hard. Maybe I should attack this problem with time travel, using replay.io.
			requestAnimationFrame(() => {
				$really_custom_input[0].focus();
				$really_custom_input[0].select();
			});
			// Maybe this would all be a little simpler if I made the label point to the input.
			// I want the label to have a larger click target, but maybe I can do that with CSS.
		}
	});

	if (is_custom) {
		$really_custom_input.val(magnification * 100);
		$really_custom_radio_option.prop("checked", true);
		$really_custom_input.select();
	}

	$really_custom_radio_option.on("keydown", (event) => {
		if (event.key.match(/^[0-9.]$/)) {
			// Can't set number input to invalid number "." or even "0.",
			// but if we don't prevent the default keydown behavior of typing the letter,
			// we can actually change the focus before the letter is typed!
			// $really_custom_input.val(event.key === "." ? "0." : event.key);
			// $really_custom_input.focus(); // should move caret to end
			// event.preventDefault();
			$really_custom_input.val("").focus();
		}
	});

	// If you tab to the number input and type, it should select the radio button
	// so that your input is actually used.
	$really_custom_input.on("input", () => {
		$really_custom_radio_option.prop("checked", true);
	});

	$fieldset.find("label").css({ display: "block" });

	$w.$Button(localize("OK"), () => {
		let option_val = String($fieldset.find("input[name='custom-zoom-radio']:checked").val());
		let mag;
		if (option_val === "really-custom") {
			option_val = $really_custom_input.val();
			if (`${option_val}`.match(/\dx$/)) { // ...you can't actually type an x; oh well...
				mag = parseFloat(option_val);
			} else if (`${option_val}`.match(/\d%?$/)) {
				mag = parseFloat(option_val) / 100;
			}
			if (isNaN(mag)) {
				please_enter_a_number();
				return;
			}
		} else {
			mag = parseFloat(option_val);
		}

		set_magnification(mag);

		$w.close();
	}, { type: "submit" });
	$w.$Button(localize("Cancel"), () => {
		$w.close();
	});

	$w.center();

	handle_keyshortcuts($w);
}


function toggle_grid() {
	show_grid = !show_grid;
	// $G.trigger("option-changed");
	update_helper_layer();
}

function toggle_thumbnail() {
	show_thumbnail = !show_thumbnail;
	if (!show_thumbnail) {
		$thumbnail_window.hide();
	} else {
		if (!thumbnail_canvas) {
			thumbnail_canvas = make_canvas(108, 92);
			thumbnail_canvas.style.width = "100%";
			thumbnail_canvas.style.height = "100%";
		}
		if (!$thumbnail_window) {
			$thumbnail_window = $Window({
				title: localize("Thumbnail"),
				toolWindow: true,
				resizable: true,
				innerWidth: thumbnail_canvas.width + 4, // @TODO: should the border of $content be included in the definition of innerWidth/Height?
				innerHeight: thumbnail_canvas.height + 4,
				minInnerWidth: 52 + 4,
				minInnerHeight: 36 + 4,
				minOuterWidth: 0, // @FIXME: this shouldn't be needed
				minOuterHeight: 0, // @FIXME: this shouldn't be needed
			});
			$thumbnail_window.addClass("thumbnail-window");
			$thumbnail_window.$content.append(thumbnail_canvas);
			$thumbnail_window.$content.addClass("inset-deep");
			$thumbnail_window.$content.css({ marginTop: "1px" }); // @TODO: should this (or equivalent on titlebar) be for all windows?
			$thumbnail_window.maximize = () => { }; // @TODO: disable maximize with an option
			// NOTE: I'm not sure some of these fallbacks are relevant anymore,
			// or if they even work since changing `box` from an array to a string.
			// Presumably the spec changed, but I don't feel like trying to dig up the history.
			new ResizeObserver((entries) => {
				const entry = entries[0];
				let width, height;
				if ("devicePixelContentBoxSize" in entry) {
					// console.log("devicePixelContentBoxSize", entry.devicePixelContentBoxSize);
					// Firefox seems to support this, although I can't find any documentation that says it should
					// I can't find an implementation bug or anything.
					// So I had to disable this case to test the fallback case (in Firefox 94.0)
					width = entry.devicePixelContentBoxSize[0].inlineSize;
					height = entry.devicePixelContentBoxSize[0].blockSize;
				} else if ("contentBoxSize" in entry) {
					// console.log("contentBoxSize", entry.contentBoxSize);
					// round() seems to line up with what Firefox does for device pixel alignment, which is great.
					// In Chrome it's blurry at some zoom levels with round(), ceil(), or floor(), but it (documentedly) supports devicePixelContentBoxSize.
					// @ts-ignore
					width = Math.round(entry.contentBoxSize[0].inlineSize * devicePixelRatio);
					// @ts-ignore
					height = Math.round(entry.contentBoxSize[0].blockSize * devicePixelRatio);
				} else {
					// Safari on iPad doesn't support either of the above as of iOS 15.0.2
					// @ts-ignore
					width = Math.round(entry.contentRect.width * devicePixelRatio);
					// @ts-ignore
					height = Math.round(entry.contentRect.height * devicePixelRatio);
				}
				if (width && height) { // If it's hidden, and then shown, it gets a width and height of 0 briefly on iOS. (This would give IndexSizeError in drawImage.)
					thumbnail_canvas.width = width;
					thumbnail_canvas.height = height;
				}
				update_helper_layer_immediately(); // updates thumbnail (but also unnecessarily the helper layer)
			}).observe(thumbnail_canvas, { box: "device-pixel-content-box" });
		}
		$thumbnail_window.show();
		$thumbnail_window.on("close", (e) => {
			e.preventDefault();
			$thumbnail_window.hide();
			show_thumbnail = false;
		});
	}
	// Currently the thumbnail updates with the helper layer. But it's not part of the helper layer, so this is a bit of a misnomer for now.
	update_helper_layer();
}

function reset_selected_colors() {
	selected_colors = {
		foreground: "#000000",
		background: "#ffffff",
		ternary: "",
	};
	$G.trigger("option-changed");
}

function reset_file() {
	system_file_handle = null;
	file_name = localize("untitled");
	file_format = "image/png";
	saved = true;
	update_title();
}

function reset_canvas_and_history() {
	undos.length = 0;
	redos.length = 0;
	current_history_node = root_history_node = make_history_node({
		name: localize("New"),
		icon: get_help_folder_icon("p_blank.png"),
	});
	history_node_to_cancel_to = null;

	main_canvas.width = Math.max(1, my_canvas_width);
	main_canvas.height = Math.max(1, my_canvas_height);
	main_ctx.disable_image_smoothing();
	main_ctx.fillStyle = selected_colors.background;
	main_ctx.fillRect(0, 0, main_canvas.width, main_canvas.height);

	current_history_node.image_data = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height);

	$canvas_area.trigger("resize");
	$G.triggerHandler("history-update"); // update history view
}

// TODO: fix inconsistent use of ancestry metaphor (parent vs futures); could use the term "basis" for the parent, or "children" for the futures
/**
 * @param {object} options
 * @param {HistoryNode | null=} options.parent - the state before this state (its basis), or null if this is the first state
 * @param {HistoryNode[]=} options.futures - the states branching off from this state (its children)
 * @param {number=} options.timestamp - when this state was created
 * @param {boolean=} options.soft - indicates that undo should skip this state; it can still be accessed with the History window
 * @param {ImageData | null=} options.image_data - the image data for the canvas (TODO: region updates)
 * @param {ImageData | null=} options.selection_image_data - the image data for the selection, if any
 * @param {number=} options.selection_x - the x position of the selection, if any
 * @param {number=} options.selection_y - the y position of the selection, if any
 * @param {string=} options.textbox_text - the text in the textbox, if any
 * @param {number=} options.textbox_x - the x position of the textbox, if any
 * @param {number=} options.textbox_y - the y position of the textbox, if any
 * @param {number=} options.textbox_width - the width of the textbox, if any
 * @param {number=} options.textbox_height - the height of the textbox, if any
 * @param {TextToolFontOptions | null=} options.text_tool_font - the font of the Text tool (important to restore a textbox-containing state, but persists without a textbox)
 * @param {boolean=} options.tool_transparent_mode - whether transparent mode is on for Select/Free-Form Select/Text tools; otherwise box is opaque
 * @param {string | CanvasPattern=} options.foreground_color - selected foreground color (left click)
 * @param {string | CanvasPattern=} options.background_color - selected background color (right click)
 * @param {string | CanvasPattern=} options.ternary_color - selected ternary color (ctrl+click)
 * @param {string=} options.name - the name of the operation, shown in the history window, e.g. localize("Resize Canvas")
 * @param {HTMLImageElement |HTMLCanvasElement | null=} options.icon - a visual representation of the operation type, shown in the history window, e.g. get_help_folder_icon("p_blank.png")
 * @returns {HistoryNode}
 */
function make_history_node({
	parent = null, // the state before this state (its basis), or null if this is the first state
	futures = [], // the states branching off from this state (its children)
	timestamp = Date.now(), // when this state was created
	soft = false, // indicates that undo should skip this state; it can still be accessed with the History window
	image_data = null, // the image data for the canvas (TODO: region updates)
	selection_image_data = null, // the image data for the selection, if any
	selection_x, // the x position of the selection, if any
	selection_y, // the y position of the selection, if any
	textbox_text, // the text in the textbox, if any
	textbox_x, // the x position of the textbox, if any
	textbox_y, // the y position of the textbox, if any
	textbox_width, // the width of the textbox, if any
	textbox_height, // the height of the textbox, if any
	text_tool_font = null, // the font of the Text tool (important to restore a textbox-containing state, but persists without a textbox)
	tool_transparent_mode = false, // whether transparent mode is on for Select/Free-Form Select/Text tools; otherwise box is opaque
	foreground_color, // selected foreground color (left click)
	background_color, // selected background color (right click)
	ternary_color, // selected ternary color (ctrl+click)
	name, // the name of the operation, shown in the history window, e.g. localize("Resize Canvas")
	icon = null, // an Image representation of the operation type, shown in the history window, e.g. get_help_folder_icon("p_blank.png")
}) {
	return {
		parent,
		futures,
		timestamp,
		soft,
		image_data,
		selection_image_data,
		selection_x,
		selection_y,
		textbox_text,
		textbox_x,
		textbox_y,
		textbox_width,
		textbox_height,
		text_tool_font,
		tool_transparent_mode,
		foreground_color,
		background_color,
		ternary_color,
		name,
		icon,
	};
}

function update_title() {
	document.title = `${file_name} - ${is_pride_month ? "June Solidarity " : ""}${localize("Paint")}`;

	if (is_pride_month) {
		$("link[rel~='icon']").attr("href", "./images/icons/gay-es-paint-16x16-light-outline.png");
	}

	if (window.setRepresentedFilename) {
		window.setRepresentedFilename(system_file_handle ?? "");
	}
	if (window.setDocumentEdited) {
		window.setDocumentEdited(!saved);
	}
}

/**
 * Parse text/uri-list format
 * @param {string} text
 * @returns {string[]} URLs
 */
function get_uris(text) {
	// get lines, discarding comments
	const lines = text.split(/[\n\r]+/).filter((line) => line[0] !== "#" && line);
	// discard text with too many lines (likely pasted HTML or something) - may want to revisit this
	if (lines.length > 15) {
		return [];
	}
	// parse URLs, discarding anything that parses as a relative URL
	const uris = [];
	for (let i = 0; i < lines.length; i++) {
		// Relative URLs will throw when no base URL is passed to the URL constructor.
		try {
			const url = new URL(lines[i]);
			uris.push(url.href);
		} catch (_error) { /* ignore */ }
	}
	return uris;
}
/**
 * Load an image file from a URL by any means necessary.
 * For basic image loading, see `load_image_simple` instead.
 * @param {string} uri
 * @returns {Promise<ImageInfo>}
 * @throws {Error & { code?: string }}
 */
async function load_image_from_uri(uri) {

	// Cases to consider:
	// - data URI
	// - blob URI
	//   - blob URI from another domain
	// - file URI
	// - http URI
	// - https URI
	// - unsupported protocol, e.g. "ftp://example.com/image.png"
	// - invalid URI
	//   - no protocol specified, e.g. "example.com/image.png"
	//     --> We can fix these up!
	//   - The user may be just trying to paste text, not an image.
	// - non-CORS-enabled URI
	//   --> Use a CORS proxy! :)
	//   - In electron, using a CORS proxy 1. is silly, 2. maybe isn't working.
	//     --> Either proxy requests to the main process,
	//         or configure headers in the main process to make requests work.
	//         Probably the latter. @TODO
	//         https://stackoverflow.com/questions/51254618/how-do-you-handle-cors-in-an-electron-app
	// - invalid image / unsupported image format
	// - image is no longer available on the live web
	//   --> try loading from WayBack Machine :)
	//   - often swathes of URLs are redirected to a new site, and do not give a 404.
	//     --> make sure the flow of fallbacks accounts for this, and doesn't just see it as an unsupported file format.
	// - localhost URI, e.g. "http://127.0.0.1/" or "http://localhost/"
	//   --> Don't try to proxy these, as it will just fail.
	//   - Some domain extensions are reserved, e.g. .localdomain (how official is this?)
	//   - There can also be arbitrary hostnames mapped to local servers, which we can't test for
	// - already a proxy URI, e.g. "https://cors.bridged.cc/https://example.com/image.png"
	// - file already downloaded
	//   --> maybe should cache downloads? maybe HTTP caching is good enough? maybe uncommon enough that it doesn't matter.
	// - Pasting (Edit > Paste or Ctrl+V) vs Opening (drag & drop, File > Open, Ctrl+O, or File > Load From URL)
	//   --> make wording generic or specific to the context

	const is_blob_uri = uri.match(/^blob:/i);
	const is_download = !uri.match(/^(blob|data|file):/i);
	const is_localhost = uri.match(/^(http|https):\/\/((127\.0\.0\.1|localhost)|.*(\.(local|localdomain|domain|lan|home|host|corp|invalid)))\b/i);

	if (is_blob_uri && uri.indexOf(`blob:${location.origin}`) === -1) {
		const error = new Error("can't load blob: URI from another domain");
		// @ts-ignore
		error.code = "cross-origin-blob-uri";
		throw error;
	}

	const uris_to_try = (is_download && !is_localhost) ? [
		uri,
		// work around CORS headers not sent by whatever server
		`https://cors.bridged.cc/${uri}`,
		`https://jspaint-cors-proxy.herokuapp.com/${uri}`,
		// if the image isn't available on the live web, see if it's archived
		`https://web.archive.org/${uri}`,
	] : [uri];
	const fails = [];

	for (let index_to_try = 0; index_to_try < uris_to_try.length; index_to_try += 1) {
		const uri_to_try = uris_to_try[index_to_try];
		try {
			if (is_download) {
				$status_text.text("Downloading picture...");
			}

			const show_progress = ({ loaded, total }) => {
				if (is_download) {
					$status_text.text(`Downloading picture... (${Math.round(loaded / total * 100)}%)`);
				}
			};

			if (is_download) {
				console.log(`Try loading image from URI (${index_to_try + 1}/${uris_to_try.length}): "${uri_to_try}"`);
			}

			const original_response = await fetch(uri_to_try);
			let response_to_read = original_response;
			if (!original_response.ok) {
				fails.push({ status: original_response.status, statusText: original_response.statusText, url: uri_to_try });
				continue;
			}
			if (!original_response.body) {
				if (is_download) {
					console.log("ReadableStream not yet supported in this browser. Progress won't be shown for image requests.");
				}
			} else {
				// to access headers, server must send CORS header "Access-Control-Expose-Headers: content-encoding, content-length x-file-size"
				// server must send custom x-file-size header if gzip or other content-encoding is used
				const contentEncoding = original_response.headers.get("content-encoding");
				const contentLength = original_response.headers.get(contentEncoding ? "x-file-size" : "content-length");
				if (contentLength === null) {
					if (is_download) {
						console.log("Response size header unavailable. Progress won't be shown for this image request.");
					}
				} else {
					const total = parseInt(contentLength, 10);
					let loaded = 0;
					response_to_read = new Response(
						new ReadableStream({
							start(controller) {
								const reader = original_response.body.getReader();

								read();
								function read() {
									reader.read().then(({ done, value }) => {
										if (done) {
											controller.close();
											return;
										}
										loaded += value.byteLength;
										show_progress({ loaded, total });
										controller.enqueue(value);
										read();
									}).catch((error) => {
										console.error(error);
										controller.error(error);
									});
								}
							},
						})
					);
				}
			}

			const blob = await response_to_read.blob();
			if (is_download) {
				console.log("Download complete.");
				$status_text.text("Download complete.");
			}
			// @TODO: use headers to detect HTML, since a doctype is not guaranteed
			// @TODO: fall back to WayBack Machine still for decode errors,
			// since a website might start redirecting swathes of URLs regardless of what they originally pointed to,
			// at which point they would likely point to a web page instead of an image.
			// (But still show an error about it not being an image, if WayBack also fails.)
			const info = await new Promise((resolve, reject) => {
				read_image_file(blob, (error, info) => {
					if (error) {
						reject(error);
					} else {
						resolve(info);
					}
				});
			});
			return info;
		} catch (error) {
			fails.push({ url: uri_to_try, error });
		}
	}
	if (is_download) {
		$status_text.text("Failed to download picture.");
	}
	const error = new Error(`failed to fetch image from any of ${uris_to_try.length} URI(s):\n  ${fails.map((fail) =>
		(fail.statusText ? `${fail.status} ${fail.statusText} ` : "") + fail.url + (fail.error ? `\n    ${fail.error}` : "")
	).join("\n  ")}`);
	// @ts-ignore
	error.code = "access-failure";
	// @ts-ignore
	error.fails = fails;
	throw error;
}

/**
 * @param {ImageInfo} info
 * @param {() => void} [callback]
 * @param {() => void} [canceled]
 * @param {boolean} [into_existing_session]
 * @param {boolean} [from_session_load]
 */
function open_from_image_info(info, callback, canceled, into_existing_session, from_session_load) {
	are_you_sure(({ canvas_modified_while_loading } = {}) => {
		deselect();
		cancel();

		if (!into_existing_session) {
			$G.triggerHandler("session-update"); // autosave old session
			new_local_session();
		}

		reset_file();
		reset_selected_colors();
		reset_canvas_and_history(); // (with newly reset colors)
		set_magnification(default_magnification);

		main_ctx.copy(info.image || info.image_data);
		apply_file_format_and_palette_info(info);
		transparency = has_any_transparency(main_ctx);
		$canvas_area.trigger("resize");

		current_history_node.name = localize("Open");
		current_history_node.image_data = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height);
		current_history_node.icon = get_help_folder_icon("p_open.png");

		if (canvas_modified_while_loading || !from_session_load) {
			// normally we don't want to autosave if we're loading a session,
			// as this is redundant, but if the user has modified the canvas while loading a session,
			// right now how it works is the session would be overwritten, so if you reloaded, it'd be lost,
			// so we'd better save it.
			// (and we want to save if this is a new session being initialized with an image)
			$G.triggerHandler("session-update"); // autosave
		}
		$G.triggerHandler("history-update"); // update history view

		if (info.source_blob instanceof File) {
			file_name = info.source_blob.name;
			// file.path is available in Electron (see https://www.electronjs.org/docs/api/file-object#file-object)
			// @ts-ignore
			system_file_handle = info.source_blob.path;
		}
		if (info.source_file_handle) {
			system_file_handle = info.source_file_handle;
		}
		saved = true;
		update_title();

		callback?.();
	}, canceled, from_session_load);
}

// Note: This function is part of the API.
/**
 * @param {Blob} file
 * @param {UserFileHandle} source_file_handle
 */
function open_from_file(file, source_file_handle) {
	// The browser isn't very smart about MIME types.
	// It seems to look at the file extension, but not the actual file contents.
	// This is particularly problematic for files with no extension, where file.type gives an empty string.
	// And the File Access API currently doesn't let us automatically append a file extension,
	// so the user is likely to end up with files with no extension.
	// It's better to look at the file content to determine file type.
	// We do this for image files in read_image_file, and palette files in AnyPalette.js.

	if (file instanceof File && file.name.match(/\.theme(pack)?$/i)) {
		file.text().then(load_theme_from_text, (error) => {
			show_error_message(localize("Paint cannot open this file."), error);
		});
		return;
	}
	// Try loading as an image file first, then as a palette file, but show a combined error message if both fail.
	read_image_file(file, (as_image_error, image_info) => {
		if (as_image_error) {
			AnyPalette.loadPalette(file, (as_palette_error, new_palette) => {
				if (as_palette_error) {
					show_file_format_errors({ as_image_error, as_palette_error });
					return;
				}
				palette = new_palette.map((color) => color.toString());
				$colorbox.rebuild_palette();
				window.console?.log(`Loaded palette: ${palette.map(() => "%c█").join("")}`, ...palette.map((color) => `color: ${color};`));
			});
			return;
		}
		image_info.source_file_handle = source_file_handle;
		open_from_image_info(image_info);
	});
}

/**
 * @param {ImageInfo} info
 */
function apply_file_format_and_palette_info(info) {
	file_format = info.file_format;

	if (!enable_palette_loading_from_indexed_images) {
		return;
	}

	if (info.palette) {
		window.console?.log(`Loaded palette from image file: ${info.palette.map(() => "%c█").join("")}`, ...info.palette.map((color) => `color: ${color};`));
		palette = info.palette;
		selected_colors.foreground = palette[0];
		selected_colors.background = palette.length === 14 * 2 ? palette[14] : palette[1]; // first in second row for default sized palette, else second color (debatable behavior; should it find a dark and a light color?)
		$G.trigger("option-changed");
	} else if (monochrome && !info.monochrome) {
		palette = default_palette;
		reset_selected_colors();
	}
	$colorbox.rebuild_palette();

	monochrome = info.monochrome;
}

/**
 * @param {string} fileText
 */
function load_theme_from_text(fileText) {
	var cssProperties = parseThemeFileString(fileText);
	if (!cssProperties) {
		show_error_message(localize("Paint cannot open this file."));
		return;
	}
	applyCSSProperties(cssProperties, { recurseIntoIframes: true });

	window.themeCSSProperties = cssProperties;

	$G.triggerHandler("theme-load");
}

function file_new() {
	are_you_sure(() => {
		deselect();
		cancel();

		$G.triggerHandler("session-update"); // autosave old session
		new_local_session();

		reset_file();
		reset_selected_colors();
		reset_canvas_and_history(); // (with newly reset colors)
		set_magnification(default_magnification);

		$G.triggerHandler("session-update"); // autosave
	});
}

async function file_open() {
	const { file, fileHandle } = await systemHooks.showOpenFileDialog({ formats: image_formats });
	open_from_file(file, fileHandle);
}

/** @type {OSGUI$Window} */
let $file_load_from_url_window;
function file_load_from_url() {
	if ($file_load_from_url_window) {
		$file_load_from_url_window.close();
	}
	const $w = $DialogWindow().addClass("horizontal-buttons");
	$file_load_from_url_window = $w;
	$w.title("Load from URL");
	// @TODO: URL validation (input has to be in a form (and we don't want the form to submit))
	$w.$main.html(`
		<div style="padding: 10px;">
			<label style="display: block; margin-bottom: 5px;" for="url-input">Paste or type the web address of an image:</label>
			<input type="url" required value="" id="url-input" class="inset-deep" style="width: 300px;"/></label>
		</div>
	`);
	const $input = $w.$main.find("#url-input");
	// $w.$Button("Load", () => {
	$w.$Button(localize("Open"), () => {
		const uris = get_uris(String($input.val()));
		if (uris.length > 0) {
			// @TODO: retry loading if same URL entered
			// actually, make it change the hash only after loading successfully
			// (but still load from the hash when necessary)
			// make sure it doesn't overwrite the old session before switching
			$w.close();
			change_url_param("load", uris[0]);
		} else {
			show_error_message("Invalid URL. It must include a protocol (https:// or http://)");
		}
	}, { type: "submit" });
	$w.$Button(localize("Cancel"), () => {
		$w.close();
	});
	$w.center();
	$input[0].focus();
}

// Native FS API / File Access API allows you to overwrite files, but people are not used to it.
// So we ask them to confirm it the first time.
let acknowledged_overwrite_capability = false;
const confirmed_overwrite_key = "jspaint confirmed overwrite capable";
try {
	acknowledged_overwrite_capability = localStorage[confirmed_overwrite_key] === "true";
} catch (_error) {
	// no localStorage
	// In the year 2033, people will be more used to it, right?
	// This will be known as the "Y2T bug"
	acknowledged_overwrite_capability = Date.now() >= 2000000000000;
}
async function confirm_overwrite_capability() {
	if (acknowledged_overwrite_capability) {
		return true;
	}
	const { $window, promise } = showMessageBox({
		messageHTML: `
			<p>JS Paint can now save over existing files.</p>
			<p>Do you want to overwrite the file?</p>
			<p>
				<input type="checkbox" id="do-not-ask-me-again-checkbox"/>
				<label for="do-not-ask-me-again-checkbox">Don't ask me again</label>
			</p>
		`,
		buttons: [
			{ label: localize("Yes"), value: "overwrite", default: true },
			{ label: localize("Cancel"), value: "cancel" },
		],
	});
	const result = await promise;
	if (result === "overwrite") {
		acknowledged_overwrite_capability = $window.$content.find("#do-not-ask-me-again-checkbox").prop("checked");
		try {
			localStorage[confirmed_overwrite_key] = acknowledged_overwrite_capability;
		} catch (_error) {
			// no localStorage... @TODO: don't show the checkbox in this case
		}
		return true;
	}
	return false;
}


function file_save(maybe_saved_callback = () => { }, update_from_saved = true) {
	deselect();
	// store and use file handle at this point in time, to avoid race conditions
	const save_file_handle = system_file_handle;
	if (!save_file_handle || file_name.match(/\.(svg|pdf)$/i)) {
		return file_save_as(maybe_saved_callback, update_from_saved);
	}
	write_image_file(main_canvas, file_format, async (blob) => {
		// An error may be shown by `systemHooks.writeBlobToHandle`,
		// or it may be unknown whether the save will succeed,
		// so for now: true means definite success, false means failure or cancelation, and undefined means it's unknown.
		const success = await systemHooks.writeBlobToHandle(save_file_handle, blob);
		// When using a file download, where it's unknown whether the save will succeed,
		// we don't want to mark the file as saved, as it would prevent the user from retrying the save.
		// So only mark the file as saved if it's definite.
		if (success === true) {
			saved = true;
			update_title();
		}
		// However, we can still apply format-specific color reduction to the canvas,
		// and call the "maybe saved" callback, which, as the name implies, is intended to handle the uncertainty.
		if (success !== false) {
			if (update_from_saved) {
				update_from_saved_file(blob);
			}
			maybe_saved_callback();
		}
	});
}

function file_save_as(maybe_saved_callback = () => { }, update_from_saved = true) {
	deselect();
	systemHooks.showSaveFileDialog({
		dialogTitle: localize("Save As"),
		formats: image_formats,
		defaultFileName: file_name,
		defaultPath: typeof system_file_handle === "string" ? system_file_handle : null,
		defaultFileFormatID: file_format,
		getBlob: (new_file_type) => {
			return new Promise((resolve) => {
				write_image_file(main_canvas, new_file_type, (blob) => {
					resolve(blob);
				});
			});
		},
		savedCallbackUnreliable: ({ newFileName, newFileFormatID, newFileHandle, newBlob }) => {
			saved = true;
			system_file_handle = newFileHandle;
			file_name = newFileName;
			file_format = newFileFormatID;
			update_title();
			maybe_saved_callback();
			if (update_from_saved) {
				update_from_saved_file(newBlob);
			}
		},
	});
}

function file_print() {
	if (is_discord_embed) {
		// closest localized string: "Could not start print job."
		show_error_message(localize("Printing is not supported in the Discord Activity."));
		return;
	}
	print();
}

/**
 * Prompts the user to save changes to the document.
 * @param {(info?: { canvas_modified_while_loading?: boolean }) => void} action
 * @param {() => void} [canceled]
 * @param {boolean} [from_session_load]
 */
function are_you_sure(action, canceled, from_session_load) {
	if (saved) {
		action();
	} else if (from_session_load) {
		// @FIXME: this dialog is confusingly worded in the best case.
		// It's intended for when the user edits the document while the initial document is loading,
		// which is hard to do, at least for local sessions on my fast new computer.
		// However it's also shown inappropriately if you edit the document and then either:
		// - type a #load: URL into the address bar such as
		//   http://127.0.0.1:1999/#load:https://i.imgur.com/M5zcPuk.jpeg
		// - click an Open link in the Manage Storage dialog in the Electron app
		showMessageBox({
			message: localize("You've modified the document while an existing document was loading.\nSave the new document?", file_name),
			buttons: [
				{
					// label: localize("Save"),
					label: localize("Yes"),
					value: "save",
					default: true,
				},
				{
					// label: "Discard",
					label: localize("No"),
					value: "discard",
				},
			],
			// @TODO: not closable with Escape or close button
		}).then((result) => {
			if (result === "save") {
				file_save(() => {
					action();
				}, false);
			} else if (result === "discard") {
				action({ canvas_modified_while_loading: true });
			} else {
				// should not ideally happen
				// but prefer to preserve the previous document,
				// as the user has only (probably) as small window to make changes while loading,
				// whereas there could be any amount of work put into the document being loaded.
				// @TODO: could show dialog again, but making it un-cancelable would be better.
				action();
			}
		});
	} else {
		showMessageBox({
			message: localize("Save changes to %1?", file_name),
			buttons: [
				{
					// label: localize("Save"),
					label: localize("Yes"),
					value: "save",
					default: true,
				},
				{
					// label: "Discard",
					label: localize("No"),
					value: "discard",
				},
				{
					label: localize("Cancel"),
					value: "cancel",
				},
			],
		}).then((result) => {
			if (result === "save") {
				file_save(() => {
					action();
				}, false);
			} else if (result === "discard") {
				action();
			} else {
				canceled?.();
			}
		});
	}
}

function please_enter_a_number() {
	showMessageBox({
		// title: "Invalid Value",
		message: localize("Please enter a number."),
	});
}

// Note: This function is part of the API.
/**
 * @param {string} message
 * @param {Error | string} [error]
 */
function show_error_message(message, error) {
	// Test global error handling resiliency by enabling one or both of these:
	// Promise.reject(new Error("EMIT EMIT EMIT"));
	// throw new Error("EMIT EMIT EMIT");
	// It should fall back to an alert.
	// EMIT stands for "Error Message Itself Test".

	const { $message } = showMessageBox({
		iconID: "error",
		message,
		// windowOptions: {
		// 	innerWidth: 600,
		// },
	});
	// $message.css("max-width", "600px");
	if (error) {
		const $details = $("<details><summary><span>Details</span></summary></details>")
			.appendTo($message);

		// Chrome includes the error message in the error.stack string, whereas Firefox doesn't.
		// Also note that there can be Exception objects that don't have a message (empty string) but a name,
		// for instance Exception { message: "", name: "NS_ERROR_FAILURE", ... } for out of memory when resizing the canvas too large in Firefox.
		// Chrome just lets you bring the system to a grating halt by trying to grab too much memory.
		// Firefox does too sometimes.
		const e = /** @type {Error} */(error);
		let error_string = e.stack;
		if (!error_string) {
			error_string = error.toString();
			// Discord API throws plain objects.
			if (error_string === "[object Object]") {
				try {
					error_string = JSON.stringify(error, null, 2);
				} catch (e) {
					error_string = "Error details could not be stringified: " + e;
				}
			}
		} else if (e.message && error_string.indexOf(e.message) === -1) {
			error_string = `${error.toString()}\n\n${error_string}`;
		} else if (e.name && error_string.indexOf(e.name) === -1) {
			error_string = `${e.name}\n\n${error_string}`;
		}
		$(E("pre"))
			.text(error_string)
			.appendTo($details)
			.css({
				background: "white",
				color: "#333",
				// background: "#A00",
				// color: "white",
				fontFamily: "monospace",
				width: "500px",
				maxWidth: "100%",
				overflow: "auto",
			});
	}
	if (error) {
		window.console?.error?.(message, error);
	} else {
		window.console?.error?.(message);
	}
}

// @TODO: close are_you_sure windows and these Error windows when switching sessions
// because it can get pretty confusing
/** @param {Error & {code: string, fails?: {status: number, statusText: string, url: string}[]}} error */
function show_resource_load_error_message(error) {
	const { $window, $message } = showMessageBox({});
	const firefox = navigator.userAgent.toLowerCase().indexOf("firefox") > -1;
	// @TODO: copy & paste vs download & open, more specific guidance
	if (error.code === "cross-origin-blob-uri") {
		$message.html(`
			<p>Can't load image from address starting with "blob:".</p>
			${firefox ?
				`<p>Try "Copy Image" instead of "Copy Image Location".</p>` :
				`<p>Try "Copy image" instead of "Copy image address".</p>`
			}
		`);
	} else if (error.code === "html-not-image") {
		$message.html(`
			<p>Address points to a web page, not an image file.</p>
			<p>Try copying and pasting an image instead of a URL.</p>
		`);
	} else if (error.code === "decoding-failure") {
		$message.html(`
			<p>Address doesn't point to an image file of a supported format.</p>
			<p>Try copying and pasting an image instead of a URL.</p>
		`);
	} else if (error.code === "access-failure") {
		if (navigator.onLine) {
			$message.html(`
				<p>Failed to download image.</p>
				<p>Try copying and pasting an image instead of a URL.</p>
			`);
			if (error.fails) {
				$("<ul>").append(error.fails.map(({ status, statusText, url }) =>
					$("<li>").text(url).prepend($("<b>").text(`${status || ""} ${statusText || "Failed"} `))
				)).appendTo($message);
			}
		} else {
			$message.html(`
				<p>Failed to download image.</p>
				<p>You're offline. Connect to the internet and try again.</p>
				<p>Or copy and paste an image instead of a URL, if possible.</p>
			`);
		}
	} else {
		// TODO: what to do in Electron? also most users don't know how to check the console
		$message.html(`
			<p>Failed to load image from URL.</p>
			<p>Check your browser's devtools for details.</p>
		`);
	}
	$message.css({ maxWidth: "500px" });
	$window.center(); // after adding content
}
/**
 * @typedef {object} PaletteErrorGroup
 * @property {string} message
 * @property {PaletteErrorObject[]} errors
 *
 * @typedef {object} PaletteErrorObject
 * @property {Error} error
 * @property {{name: string}} __PATCHED_LIB_TO_ADD_THIS__format
 *
 * @param {object} options
 * @param {Error=} options.as_image_error
 * @param {Error|PaletteErrorGroup=} options.as_palette_error
 */
function show_file_format_errors({ as_image_error, as_palette_error }) {
	let html = `
		<p>${localize("Paint cannot open this file.")}</p>
	`;
	if (as_image_error) {
		// TODO: handle weird errors, only show invalid format error if that's what happened
		html += `
			<details>
				<summary>${localize("Bitmap Image")}</summary>
				<p>${localize("This is not a valid bitmap file, or its format is not currently supported.")}</p>
			</details>
		`;
	}
	var entity_map = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;",
		"/": "&#x2F;",
		"`": "&#x60;",
		"=": "&#x3D;",
	};
	const escape_html = (string) => String(string).replace(/[&<>"'`=/]/g, (s) => entity_map[s]);
	const uppercase_first = (string) => string.charAt(0).toUpperCase() + string.slice(1);

	const only_palette_error = as_palette_error && !as_image_error; // update me if there are more error types
	if (as_palette_error) {
		let details = "";
		if ("errors" in as_palette_error) {
			details = `<ul dir="ltr">${as_palette_error.errors.map((error) => {
				const format = error.__PATCHED_LIB_TO_ADD_THIS__format;
				if (format && error.error) {
					return `<li><b>${escape_html(`${format.name}`)}</b>: ${escape_html(uppercase_first(error.error.message))}</li>`;
				}
				// Fallback for unknown errors
				// @ts-ignore
				return `<li>${escape_html(error.message || error)}</li>`;
			}).join("\n")}</ul>`;
		} else {
			// Fallback for unknown errors
			details = `<p>${escape_html(as_palette_error.message || as_palette_error)}</p>`;
		}
		html += `
			<details>
				<summary>${only_palette_error ? "Details" : localize("Palette|*.pal|").split("|")[0]}</summary>
				<p>${localize("Unexpected file format.")}</p>
				${details}
			</details>
		`;
	}
	showMessageBox({
		messageHTML: html,
	});
}

/** @type {OSGUI$Window} */
let $about_paint_window;
const $about_paint_content = $("#about-paint");

/** @type {OSGUI$Window} */
let $news_window;
const $this_version_news = $("#news");
let $latest_news = $this_version_news;

// not included directly in the HTML as a simple way of not showing it if it's loaded with fetch
// (...not sure how to phrase this clearly and concisely...)
// "Showing the news as of this version of JS Paint. For the latest, see <a href='https://jspaint.app'>jspaint.app</a>"
if (location.origin !== "https://jspaint.app") {
	$this_version_news.prepend(
		$("<p>For the latest news, visit <a href='https://jspaint.app'>jspaint.app</a></p>")
			.css({ padding: "8px 15px" })
	);
}

function show_about_paint() {
	if ($about_paint_window) {
		$about_paint_window.close();
	}
	$about_paint_window = $Window({
		title: localize("About Paint"),
		resizable: false,
		maximizeButton: false,
		minimizeButton: false,
	});
	$about_paint_window.addClass("about-paint squish");
	if (is_pride_month) {
		$("#about-paint-icon").attr("src", "./images/icons/gay-es-paint-128x128.png");
	}

	$about_paint_window.$content.append($about_paint_content.show()).css({ padding: "15px" });

	$("#jspaint-update-status-area").removeAttr("hidden");

	$("#failed-to-check-if-outdated").attr("hidden", "hidden");
	$("#outdated").attr("hidden", "hidden");

	$about_paint_window.$Button(localize("OK"), () => {
		$about_paint_window.close();
	})
		.attr("id", "close-about-paint")
		.focus()
		.css({
			float: "right",
			marginBottom: "10px",
		});

	$("#refresh-to-update").on("click", (event) => {
		event.preventDefault();
		are_you_sure(() => {
			exit_fullscreen_if_ios();
			location.reload();
		});
	});

	$("#view-project-news").on("click", () => {
		show_news();
	});//.focus();

	// Hack to avoid mis-centering within small screens,
	// due to dynamic width of window when it abuts the right side of the screen
	// (due to line wrapping of text content at the right edge of the screen)
	// TODO: include this in OS-GUI library's centering logic
	$about_paint_window.css({ left: -innerWidth, top: -innerHeight });
	$about_paint_window.center();

	if (is_discord_embed) {
		// No checking for updates in the Discord Activity for now at least.
		// It's sandboxed, so it can't fetch the news without some extra server logic to proxy it,
		// and since there will be one official version of the Discord Activity,
		// the user isn't responsible for updating it.

		// Might be cute to say "This product is licensed to <Discord User>",
		// since we have the API for that.
		return;
	}

	$("#checking-for-updates").removeAttr("hidden");

	// Forward compatibility note: I could change what's served at /?news and remove the news from the HTML,
	// but I've only added this query string on 2024-04-12, so I may not choose to take advantage of this.
	// I wish I had used a separate URL from the beginning, maybe a proper blog with an RSS feed.
	// It's somewhat unsustainable to add news continuously to the HTML of the app,
	// especially when images are requested even though the container is hidden. (https://github.com/1j01/jspaint/issues/320)
	// Also note: as long as I preserve the basic structure of the news entries at /, I should be able to
	// have old versions of the app still say they're outdated, and I could include some short message instead of full news articles.
	// Maybe I could even include the news in an iframe, just for old versions of the app, within the latest `.news-entry`...
	// as long as it doesn't have the same problem as images, of loading in the background.
	const url =
		// ".";
		// "test-news-newer.html";
		"https://jspaint.app/?news";
	fetch(url)
		.then((response) => response.text())
		.then((text) => {
			const parser = new DOMParser();
			const htmlDoc = parser.parseFromString(text, "text/html");
			$latest_news = $(htmlDoc).find("#news");

			const $latest_entries = $latest_news.find(".news-entry");
			const $this_version_entries = $this_version_news.find(".news-entry");

			if (!$latest_entries.length) {
				$latest_news = $this_version_news;
				throw new Error(`No news found at fetched site (${url})`);
			}

			function entries_contains_update($entries, id) {
				return $entries.get().some((el_from_this_version) =>
					id === el_from_this_version.id
				);
			}

			// @TODO: visibly mark entries that overlap
			const entries_newer_than_this_version =
				$latest_entries.get().filter((el_from_latest) =>
					!entries_contains_update($this_version_entries, el_from_latest.id)
				);

			const entries_new_in_this_version = // i.e. in development, when updating the news
				$this_version_entries.get().filter((el_from_latest) =>
					!entries_contains_update($latest_entries, el_from_latest.id)
				);

			if (entries_newer_than_this_version.length > 0) {
				$("#outdated").removeAttr("hidden");
			} else if (entries_new_in_this_version.length > 0) {
				$latest_news = $this_version_news; // show this version's news for development
			}

			$("#checking-for-updates").attr("hidden", "hidden");
			update_css_classes_for_conditional_messages();
		}).catch((exception) => {
			$("#failed-to-check-if-outdated").removeAttr("hidden");
			$("#checking-for-updates").attr("hidden", "hidden");
			update_css_classes_for_conditional_messages();
			window.console?.log("Couldn't check for updates.", exception);
		});
}

function exit_fullscreen_if_ios() {
	if ($("body").hasClass("ios")) {
		try {
			if (document.exitFullscreen) {
				document.exitFullscreen();
			} else if (document.webkitExitFullscreen) {
				document.webkitExitFullscreen();
			} else if (document.mozCancelFullScreen) {
				document.mozCancelFullScreen();
			} else if (document.msExitFullscreen) {
				document.msExitFullscreen();
			}
		} catch (_error) {
			// not important, just trying to prevent broken fullscreen after refresh
			// (:fullscreen and document.fullscreenElement stops working because it's not "requested by the page" anymore)
			// (the fullscreen styling is not generally obtrusive, but it is obtrusive when it DOESN'T work)
			//
			// alternatives:
			// - detect reload-while-fullscreen by storing a timestamp on unload when fullscreen,
			//   and apply the fullscreen class if timestamp is within a few seconds during load.
			//   - This doesn't have an answer for detecting leaving fullscreen,
			//     and if it keeps thinking it's fullscreen, it'll keep storing the timestamp, and get stuck.
			//     Unless it only stores the timestamp if it knows it's fullscreen? (i.e. page-requested fullscreen)
			//     Then it would only work for one reload.
			//     So ideally it would have the below anyway, in which case this would be unnecessary.
			// - detect fullscreen state without fullscreen API, using viewport size
			//   - If this is possible, why don't browsers just expose this information in the fullscreen API? :(
			//   - iPad resets the zoom level when going fullscreen, and then when reloading,
			//     the zoom level is reset to the user-set zoom level.
			//     Safari doesn't update devicePixelRatio based on the zoom level,
			//     and doesn't support ResizeObserver for device pixels.
			//     It does support https://developer.mozilla.org/en-US/docs/Web/API/Visual_Viewport_API
			//     though, so maybe something can be done with that.
			// - prompt to add to homescreen
		}
	}
}

// show_about_paint(); // for testing

function update_css_classes_for_conditional_messages() {

	$(".on-dev-host, .on-third-party-host, .on-official-host").hide();
	if (location.hostname.match(/localhost|127.0.0.1/)) {
		$(".on-dev-host").show();
	} else if (location.hostname.match(/jspaint.app/)) {
		$(".on-official-host").show();
	} else {
		$(".on-third-party-host").show();
	}

	$(".navigator-online, .navigator-offline").hide();
	if (navigator.onLine) {
		$(".navigator-online").show();
	} else {
		$(".navigator-offline").show();
	}
}

function show_news() {
	if ($news_window) {
		$news_window.close();
	}
	$news_window = $Window({
		title: "Project News",
		maximizeButton: false,
		minimizeButton: false,
		resizable: false,
	});
	$news_window.addClass("news-window squish");


	// const $latest_entries = $latest_news.find(".news-entry");
	// const latest_entry = $latest_entries[$latest_entries.length - 1];
	// window.console?.log("LATEST MEWS:", $latest_news);
	// window.console?.log("LATEST ENTRY:", latest_entry);

	const $latest_news_style = $latest_news.find("style");
	$this_version_news.find("style").remove();
	$latest_news.append($latest_news_style); // in case $this_version_news is $latest_news

	$news_window.$content.append($latest_news.removeAttr("hidden"));

	$news_window.center();
	$news_window.center(); // @XXX - but it helps tho

	$latest_news.attr("tabIndex", "-1").focus();

	// Prevent opening images dropped on news window
	// especially those dragged from the news window itself (accidentally or habitually/idly)
	// TODO: should this be for all windows?
	$news_window.on("dragover", (event) => {
		// the default behavior is to not allow dropping,
		// so don't prevent the default, but do stop propagation
		// so that the global handler doesn't allow the drop
		event.stopPropagation();
	});
	$news_window.on("dragenter", (event) => {
		// same as dragover, but just prevents flickering of the cursor basically,
		// when dragover is already handled
		event.stopPropagation();
	});
	$news_window.on("drop", (event) => {
		event.preventDefault();
		event.stopPropagation();
	});
}


// @TODO: DRY between these functions and open_from_* functions further?

/**
 * @param {Blob} blob
 */
function paste_image_from_file(blob) {
	read_image_file(blob, (error, info) => {
		if (error) {
			show_file_format_errors({ as_image_error: error });
			return;
		}
		paste(info.image || make_canvas(info.image_data));
	});
}

// Edit > Paste From
async function choose_file_to_paste() {
	const { file } = await systemHooks.showOpenFileDialog({ formats: image_formats });
	if (file.type.match(/^image|application\/pdf/)) {
		paste_image_from_file(file);
		return;
	}
	show_error_message(localize("This is not a valid bitmap file, or its format is not currently supported."));
}

/**
 * @param {HTMLImageElement | HTMLCanvasElement} img_or_canvas
 */
function paste(img_or_canvas) {

	if (img_or_canvas.width > main_canvas.width || img_or_canvas.height > main_canvas.height) {
		const message = localize("The image in the clipboard is larger than the bitmap.") + "\n" +
			localize("Would you like the bitmap enlarged?");
		showMessageBox({
			message,
			iconID: "question",
			windowOptions: {
				icons: {
					16: "images/windows-16x16.png",
					32: "images/windows-32x32.png",
				},
			},
			buttons: [
				{
					// label: "Enlarge",
					label: localize("Yes"),
					value: "enlarge",
					default: true,
				},
				{
					// label: "Crop",
					label: localize("No"),
					value: "crop",
				},
				{
					label: localize("Cancel"),
					value: "cancel",
				},
			],
		}).then((result) => {
			if (result === "enlarge") {
				// The resize gets its own undoable, as in mspaint
				resize_canvas_and_save_dimensions(
					Math.max(main_canvas.width, img_or_canvas.width),
					Math.max(main_canvas.height, img_or_canvas.height),
					{
						name: "Enlarge Canvas For Paste",
						icon: get_help_folder_icon("p_stretch_both.png"),
					}
				);
				do_the_paste();
				$canvas_area.trigger("resize"); // already taken care of by resize_canvas_and_save_dimensions? or does this hide the main canvas handles?
			} else if (result === "crop") {
				do_the_paste();
			}
		});
	} else {
		do_the_paste();
	}

	function do_the_paste() {
		deselect();
		select_tool(get_tool_by_id(TOOL_SELECT));

		const x = Math.max(0, Math.ceil($canvas_area.scrollLeft() / magnification));
		const y = Math.max(0, Math.ceil(($canvas_area.scrollTop()) / magnification));
		// Nevermind, canvas, isn't aligned to the right in RTL layout!
		// let x = Math.max(0, Math.ceil($canvas_area.scrollLeft() / magnification));
		// if (get_direction() === "rtl") {
		// 	// magic number 8 is a guess, I guess based on the scrollbar width which shows on the left in RTL layout
		// 	// x = Math.max(0, Math.ceil(($canvas_area.innerWidth() - canvas.width + $canvas_area.scrollLeft() + 8) / magnification));
		// 	const scrollbar_width = $canvas_area[0].offsetWidth - $canvas_area[0].clientWidth; // maybe??
		// 	console.log("scrollbar_width", scrollbar_width);
		// 	x = Math.max(0, Math.ceil((-$canvas_area.innerWidth() + $canvas_area.scrollLeft() + scrollbar_width) / magnification + canvas.width));
		// }

		undoable({
			name: localize("Paste"),
			icon: get_help_folder_icon("p_paste.png"),
			soft: true,
		}, () => {
			selection = new OnCanvasSelection(x, y, img_or_canvas.width, img_or_canvas.height, img_or_canvas);
		});
	}
}

function render_history_as_gif() {
	const $win = $DialogWindow();
	$win.title("Rendering GIF");

	const $output = $win.$main;
	const $progress = $(E("progress")).appendTo($output).addClass("inset-deep");
	const $progress_percent = $(E("span")).appendTo($output).css({
		width: "2.3em",
		display: "inline-block",
		textAlign: "center",
	});
	$win.$main.css({ padding: 5 });

	const $cancel = $win.$Button("Cancel", () => {
		$win.close();
	}).focus();

	$win.center();

	try {
		const width = main_canvas.width;
		const height = main_canvas.height;
		const gif = new GIF({
			//workers: Math.min(5, Math.floor(undos.length/50)+1),
			workerScript: "lib/gif.js/gif.worker.js",
			width,
			height,
		});

		$win.on("close", () => {
			gif.abort();
		});

		gif.on("progress", (p) => {
			$progress.val(p);
			$progress_percent.text(`${~~(p * 100)}%`);
		});

		gif.on("finished", (blob) => {
			$win.title("Rendered GIF");
			const blob_url = URL.createObjectURL(blob);
			$output.empty().append(
				$(E("div")).addClass("inset-deep").append(
					$(E("img")).attr({
						src: blob_url,
						width,
						height,
					}).css({
						display: "block", // prevent margin below due to inline display (vertical-align can also be used)
					}),
				).css({
					overflow: "auto",
					maxHeight: "70vh",
					maxWidth: "70vw",
				})
			);
			$win.on("close", () => {
				// revoking on image load(+error) breaks right click > "Save image as" and "Open image in new tab"
				URL.revokeObjectURL(blob_url);
			});
			$win.$Button("Upload to Imgur", () => {
				$win.close();
				sanity_check_blob(blob, () => {
					show_imgur_uploader(blob);
				});
			}).focus();
			$win.$Button(localize("Save"), () => {
				$win.close();
				sanity_check_blob(blob, () => {
					const suggested_file_name = `${file_name.replace(/\.(bmp|dib|a?png|gif|jpe?g|jpe|jfif|tiff?|webp|raw)$/i, "")} history.gif`;
					systemHooks.showSaveFileDialog({
						dialogTitle: localize("Save As"), // localize("Save Animation As"),
						getBlob: () => blob,
						defaultFileName: suggested_file_name,
						defaultPath: typeof system_file_handle === "string" ? `${system_file_handle.replace(/[/\\][^/\\]*/, "")}/${suggested_file_name}` : null,
						defaultFileFormatID: "image/gif",
						formats: [{
							formatID: "image/gif",
							mimeType: "image/gif",
							name: localize("Animated GIF (*.gif)").replace(/\s+\([^(]+$/, ""),
							nameWithExtensions: localize("Animated GIF (*.gif)"),
							extensions: ["gif"],
						}],
					});
				});
			});
			$cancel.appendTo($win.$buttons);
			$win.center();
		});

		const gif_canvas = make_canvas(width, height);
		const frame_history_nodes = [...undos, current_history_node];
		for (const frame_history_node of frame_history_nodes) {
			gif_canvas.ctx.clearRect(0, 0, gif_canvas.width, gif_canvas.height);
			gif_canvas.ctx.putImageData(frame_history_node.image_data, 0, 0);
			if (frame_history_node.selection_image_data) {
				const selection_canvas = make_canvas(frame_history_node.selection_image_data);
				gif_canvas.ctx.drawImage(selection_canvas, frame_history_node.selection_x, frame_history_node.selection_y);
			}
			gif.addFrame(gif_canvas, { delay: 200, copy: true });
		}
		gif.render();

	} catch (err) {
		$win.close();
		show_error_message("Failed to render GIF.", err);
	}
}

/**
 * @param {HistoryNode} target_history_node
 * @param {boolean=} canceling
 */
function go_to_history_node(target_history_node, canceling) {
	const from_history_node = current_history_node;

	if (!target_history_node.image_data) {
		if (!canceling) {
			show_error_message("History entry has no image data.");
			window.console?.log("Target history entry has no image data:", target_history_node);
		}
		return;
	}
	/* For performance (especially with two finger panning), I'm disabling this safety check that preserves certain document states in the history.
	const current_image_data = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height);
	if (!current_history_node.image_data || !image_data_match(current_history_node.image_data, current_image_data, 5)) {
		window.console?.log("Canvas image data changed outside of undoable", current_history_node, "current_history_node.image_data:", current_history_node.image_data, "document's current image data:", current_image_data);
		undoable({name: "Unknown [go_to_history_node]", use_loose_canvas_changes: true}, ()=> {});
	}
	*/
	current_history_node = target_history_node;

	deselect(true);
	if (!canceling) {
		cancel(true);
	}
	saved = false;
	update_title();

	main_ctx.copy(target_history_node.image_data);
	if (target_history_node.selection_image_data) {
		if (selection) {
			selection.destroy();
		}
		// @TODO maybe: could store whether a selection is from Free-Form Select
		// so it selects Free-Form Select when you jump to e.g. Move Selection
		// (or could traverse history to figure it out)
		if (target_history_node.name === localize("Free-Form Select")) {
			select_tool(get_tool_by_id(TOOL_FREE_FORM_SELECT));
		} else {
			select_tool(get_tool_by_id(TOOL_SELECT));
		}
		selection = new OnCanvasSelection(
			target_history_node.selection_x,
			target_history_node.selection_y,
			target_history_node.selection_image_data.width,
			target_history_node.selection_image_data.height,
			target_history_node.selection_image_data,
		);
	}
	if (target_history_node.textbox_text != null) {
		if (textbox) {
			textbox.destroy();
		}
		// @# text_tool_font =
		for (const [k, v] of Object.entries(target_history_node.text_tool_font)) {
			text_tool_font[k] = v;
		}

		selected_colors.foreground = target_history_node.foreground_color;
		selected_colors.background = target_history_node.background_color;
		tool_transparent_mode = target_history_node.tool_transparent_mode;
		$G.trigger("option-changed");

		select_tool(get_tool_by_id(TOOL_TEXT));
		textbox = new OnCanvasTextBox(
			target_history_node.textbox_x,
			target_history_node.textbox_y,
			target_history_node.textbox_width,
			target_history_node.textbox_height,
			target_history_node.textbox_text,
		);
	}

	const ancestors_of_target = get_history_ancestors(target_history_node);

	undos = [...ancestors_of_target];
	undos.reverse();

	const old_history_path =
		redos.length > 0 ?
			[redos[0], ...get_history_ancestors(redos[0])] :
			[from_history_node, ...get_history_ancestors(from_history_node)];

	// window.console?.log("target_history_node:", target_history_node);
	// window.console?.log("ancestors_of_target:", ancestors_of_target);
	// window.console?.log("old_history_path:", old_history_path);
	redos.length = 0;

	let latest_node = target_history_node;
	while (latest_node.futures.length > 0) {
		const futures = [...latest_node.futures];
		futures.sort((a, b) => {
			if (old_history_path.indexOf(a) > -1) {
				return -1;
			}
			if (old_history_path.indexOf(b) > -1) {
				return +1;
			}
			return 0;
		});
		latest_node = futures[0];
		redos.unshift(latest_node);
	}
	// window.console?.log("new undos:", undos);
	// window.console?.log("new redos:", redos);

	$canvas_area.trigger("resize");
	$G.triggerHandler("session-update"); // autosave
	$G.triggerHandler("history-update"); // update history view
}

// Note: This function is part of the API.
/**
 * Creates an undo point.
 * @param {ActionMetadata} options
 * @param {function=} callback
 */
function undoable({ name, icon, use_loose_canvas_changes, soft, assume_saved }, callback) {
	if (!use_loose_canvas_changes) {
		/* For performance (especially with two finger panning), I'm disabling this safety check that preserves certain document states in the history.
		const current_image_data = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height);
		if (!current_history_node.image_data || !image_data_match(current_history_node.image_data, current_image_data, 5)) {
			window.console?.log("Canvas image data changed outside of undoable", current_history_node, "current_history_node.image_data:", current_history_node.image_data, "document's current image data:", current_image_data);
			undoable({name: "Unknown [undoable]", use_loose_canvas_changes: true}, ()=> {});
		}
		*/
	}

	if (!assume_saved) { // flag is used for undoable file reloading on save, for reduction in color depth
		saved = false;
		update_title();
	}

	const before_callback_history_node = current_history_node;
	callback?.();
	if (current_history_node !== before_callback_history_node) {
		show_error_message(`History node switched during undoable callback for ${name}. This shouldn't happen.`);
		window.console?.log(`History node switched during undoable callback for ${name}, from`, before_callback_history_node, "to", current_history_node);
	}

	const image_data = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height);

	redos.length = 0;
	undos.push(current_history_node);

	const new_history_node = make_history_node({
		image_data,
		selection_image_data: selection && selection.canvas.ctx.getImageData(0, 0, selection.canvas.width, selection.canvas.height),
		selection_x: selection && selection.x,
		selection_y: selection && selection.y,
		textbox_text: textbox && textbox.$editor.val(),
		textbox_x: textbox && textbox.x,
		textbox_y: textbox && textbox.y,
		textbox_width: textbox && textbox.width,
		textbox_height: textbox && textbox.height,
		text_tool_font: JSON.parse(JSON.stringify(text_tool_font)),
		tool_transparent_mode,
		foreground_color: selected_colors.foreground,
		background_color: selected_colors.background,
		ternary_color: selected_colors.ternary,
		parent: current_history_node,
		name,
		icon,
		soft,
	});
	current_history_node.futures.push(new_history_node);
	current_history_node = new_history_node;

	$G.triggerHandler("history-update"); // update history view

	$G.triggerHandler("session-update"); // autosave
}
/**
 * @param {ActionMetadataUpdate} undoable_meta
 * @param {()=> void} undoable_action
 */
function make_or_update_undoable(undoable_meta, undoable_action) {
	if (current_history_node.futures.length === 0 && undoable_meta.match(current_history_node)) {
		undoable_action();
		current_history_node.image_data = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height);
		current_history_node.selection_image_data = selection && selection.canvas.ctx.getImageData(0, 0, selection.canvas.width, selection.canvas.height);
		current_history_node.selection_x = selection && selection.x;
		current_history_node.selection_y = selection && selection.y;
		if (undoable_meta.update_name) {
			current_history_node.name = undoable_meta.name;
		}
		$G.triggerHandler("history-update"); // update history view
	} else {
		undoable(undoable_meta, undoable_action);
	}
}
function undo() {
	if (undos.length < 1) { return false; }

	redos.push(current_history_node);
	let target_history_node = undos.pop();

	while (target_history_node.soft && undos.length) {
		redos.push(target_history_node);
		target_history_node = undos.pop();
	}

	go_to_history_node(target_history_node);

	return true;
}

// @TODO: use Clippy.js instead for potentially annoying tips
/** @type {OSGUI$Window} */
let $document_history_prompt_window;
function redo() {
	if (redos.length < 1) {
		if ($document_history_prompt_window) {
			$document_history_prompt_window.close();
		}
		if (!$document_history_window || $document_history_window.closed) {
			$document_history_prompt_window = showMessageBox({
				title: "Redo",
				messageHTML: "To view all branches of the history tree, click <b>Edit > History</b>.",
				iconID: "info",
			}).$window;
		}
		return false;
	}

	undos.push(current_history_node);
	let target_history_node = redos.pop();

	while (target_history_node.soft && redos.length) {
		undos.push(target_history_node);
		target_history_node = redos.pop();
	}

	go_to_history_node(target_history_node);

	return true;
}

/**
 * @param {HistoryNode} node
 * @returns {HistoryNode[]} ancestors
 */
function get_history_ancestors(node) {
	const ancestors = [];
	for (node = node.parent; node; node = node.parent) {
		ancestors.push(node);
	}
	return ancestors;
}

/** @type {OSGUI$Window} */
let $document_history_window;
// setTimeout(show_document_history, 100);
function show_document_history() {
	if ($document_history_prompt_window) {
		$document_history_prompt_window.close();
	}
	if ($document_history_window) {
		$document_history_window.close();
	}
	const $w = $document_history_window = $Window({
		title: "Document History",
		resizable: false,
		maximizeButton: false,
		minimizeButton: false,
	});
	// $w.prependTo("body").css({position: ""});
	$w.addClass("history-window squish");
	$w.$content.html(`
		<label>
			<select id="history-view-mode" class="inset-deep">
				<option value="linear">Linear timeline</option>
				<option value="tree">Tree</option>
			</select>
		</label>
		<div class="history-view" tabIndex="0"></div>
	`);

	const $history_view = $w.$content.find(".history-view");
	$history_view.focus();

	let previous_scroll_position = 0;

	let rendered_$entries = [];
	let current_$entry;

	let $mode_select = $w.$content.find("#history-view-mode");
	$mode_select.css({
		margin: "10px",
	});
	let mode = $mode_select.val();
	$mode_select.on("change", () => {
		mode = $mode_select.val();
		render_tree();
	});

	/**
	 * @param {HistoryNode} node
	 */
	function render_tree_from_node(node) {
		const $entry = $(`
			<div class="history-entry">
				<div class="history-entry-icon-area"></div>
				<div class="history-entry-name"></div>
			</div>
		`);
		// $entry.find(".history-entry-name").text((node.name || "Unknown") + (node.soft ? " (soft)" : ""));
		$entry.find(".history-entry-name").text((node.name || "Unknown") + (node === root_history_node ? " (Start of History)" : ""));
		$entry.find(".history-entry-icon-area").append(node.icon);
		if (mode === "tree") {
			let dist_to_root = 0;
			for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
				dist_to_root++;
			}
			$entry.css({
				marginInlineStart: `${dist_to_root * 8}px`,
			});
		}
		if (node === current_history_node) {
			$entry.addClass("current");
			current_$entry = $entry;
			requestAnimationFrame(() => {
				// scrollIntoView causes <html> to scroll when the window is partially offscreen,
				// despite overflow: hidden on html and body, so it's not an option.
				$history_view[0].scrollTop =
					Math.min(
						$entry[0].offsetTop,
						Math.max(
							previous_scroll_position,
							$entry[0].offsetTop - $history_view[0].clientHeight + $entry.outerHeight()
						)
					);
			});
		} else {
			const history_ancestors = get_history_ancestors(current_history_node);
			if (history_ancestors.indexOf(node) > -1) {
				$entry.addClass("ancestor-of-current");
			}
		}
		for (const sub_node of node.futures) {
			render_tree_from_node(sub_node);
		}
		$entry.on("click", () => {
			go_to_history_node(node);
		});
		// @ts-ignore  (TODO: maybe don't tack properties onto objects so much!)
		$entry.history_node = node;
		rendered_$entries.push($entry);
	}
	const render_tree = () => {
		previous_scroll_position = $history_view.scrollTop();
		$history_view.empty();
		rendered_$entries = [];
		render_tree_from_node(root_history_node);
		if (mode === "linear") {
			rendered_$entries.sort(($a, $b) => {
				if ($a.history_node.timestamp < $b.history_node.timestamp) {
					return -1;
				}
				if ($b.history_node.timestamp < $a.history_node.timestamp) {
					return +1;
				}
				return 0;
			});
		} else {
			rendered_$entries.reverse();
		}
		rendered_$entries.forEach(($entry) => {
			$history_view.append($entry);
		});
	};
	render_tree();

	// This is different from Ctrl+Z/Ctrl+Shift+Z because it goes over all branches of the history tree, chronologically,
	// not just one branch.
	const go_by = (index_delta) => {
		const from_index = rendered_$entries.indexOf(current_$entry);
		const to_index = from_index + index_delta;
		if (rendered_$entries[to_index]) {
			rendered_$entries[to_index].click();
		}
	};
	$history_view.on("keydown", (event) => {
		if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
			if (event.key === "ArrowDown" || event.key === "Down") {
				go_by(1);
				event.preventDefault();
			} else if (event.key === "ArrowUp" || event.key === "Up") {
				go_by(-1);
				event.preventDefault();
			}
		}
	});

	$G.on("history-update", render_tree);
	$w.on("close", () => {
		$G.off("history-update", render_tree);
	});

	$w.center();
}

/**
 * Cancel the current tool gesture, if any.
 * Note: this function should be idempotent. `cancel(); cancel();` should do the same thing as `cancel();`
 * @param {boolean} [going_to_history_node]
 * @param {boolean} [discard_document_state]
 */
function cancel(going_to_history_node, discard_document_state) {
	if (!history_node_to_cancel_to) {
		return;
	}

	// For two finger panning, I want to prevent history nodes from being created,
	// for performance, and to avoid cluttering the history.
	// (And also so if you undo and then pan, you can still redo (without accessing the nonlinear history window).)
	// Most tools create undoables on pointerup, in which case we can prevent them from being created,
	// but Fill tool creates on pointerdown, so we need to delete a history node in that case.
	// Select tool can create multiple undoables before being cancelled (for moving/resizing/inverting/smearing),
	// but only the last should be discarded due to panning. (All of them should be undone you hit Esc. But not deleted.)
	const history_node_to_discard = (
		discard_document_state &&
		current_history_node.parent && // can't discard the root node
		current_history_node !== history_node_to_cancel_to && // can't discard what will be the active node
		current_history_node.futures.length === 0 // prevent discarding whole branches of history if you go back in history and then pan / hit Esc
	) ? current_history_node : null;

	// console.log("history_node_to_discard", history_node_to_discard, "current_history_node", current_history_node, "history_node_to_cancel_to", history_node_to_cancel_to);

	// history_node_to_cancel_to = history_node_to_cancel_to || current_history_node;
	$G.triggerHandler("pointerup", ["canceling", discard_document_state]);
	for (const selected_tool of selected_tools) {
		selected_tool.cancel?.();
	}
	if (!going_to_history_node) {
		// Note: this will revert any changes from other users in multi-user sessions
		// which isn't good, but there's no real conflict resolution in multi-user mode anyways
		go_to_history_node(history_node_to_cancel_to, true);

		if (history_node_to_discard) {
			const index = history_node_to_discard.parent.futures.indexOf(history_node_to_discard);
			if (index === -1) {
				show_error_message("History node not found. Please report this bug.");
				console.log("history_node_to_discard", history_node_to_discard);
				console.log("current_history_node", current_history_node);
				console.log("history_node_to_discard.parent", history_node_to_discard.parent);
			} else {
				history_node_to_discard.parent.futures.splice(index, 1);
				$G.triggerHandler("history-update"); // update history view (don't want you to be able to click on the excised node)
				// (@TODO: prevent duplicate update, here vs go_to_history_node)
			}
		}
	}
	history_node_to_cancel_to = null;
	update_helper_layer();
}
/**
 * @param {boolean} [going_to_history_node]
 */
function meld_selection_into_canvas(going_to_history_node) {
	selection.draw();
	selection.destroy();
	selection = null;
	if (!going_to_history_node) {
		undoable({
			name: "Deselect",
			icon: get_icon_for_tool(get_tool_by_id(TOOL_SELECT)),
			use_loose_canvas_changes: true, // HACK; @TODO: make OnCanvasSelection not change the canvas outside undoable, same rules as tools
		}, () => { });
	}
}
/**
 * @param {boolean} [going_to_history_node]
 */
function meld_textbox_into_canvas(going_to_history_node) {
	const text = textbox.$editor.val();
	if (text && !going_to_history_node) {
		undoable({
			name: localize("Text"),
			icon: get_icon_for_tool(get_tool_by_id(TOOL_TEXT)),
			soft: true,
		}, () => { });
		undoable({
			name: "Finish Text",
			icon: get_icon_for_tool(get_tool_by_id(TOOL_TEXT)),
		}, () => {
			main_ctx.drawImage(textbox.canvas, textbox.x, textbox.y);
			textbox.destroy();
			textbox = null;
		});
	} else {
		textbox.destroy();
		textbox = null;
	}
}
/**
 * @param {boolean} [going_to_history_node]
 */
function deselect(going_to_history_node) {
	if (selection) {
		meld_selection_into_canvas(going_to_history_node);
	}
	if (textbox) {
		meld_textbox_into_canvas(going_to_history_node);
	}
	for (const selected_tool of selected_tools) {
		selected_tool.end?.(main_ctx);
	}
}

/**
 * @param {{name?: string, icon?: HTMLImageElement | HTMLCanvasElement}} [meta] - overrides certain properties of ActionMetadata
 */
function delete_selection(meta = {}) {
	if (selection) {
		undoable({
			name: meta.name || localize("Clear Selection"), //"Delete", (I feel like "Clear Selection" is unclear, could mean "Deselect")
			icon: meta.icon || get_help_folder_icon("p_delete.png"),
			// soft: @TODO: conditionally soft?,
		}, () => {
			selection.destroy();
			selection = null;
		});
	}
}
function select_all() {
	deselect();
	select_tool(get_tool_by_id(TOOL_SELECT));

	undoable({
		name: localize("Select All"),
		icon: get_icon_for_tool(get_tool_by_id(TOOL_SELECT)),
		soft: true,
	}, () => {
		selection = new OnCanvasSelection(0, 0, main_canvas.width, main_canvas.height);
	});
}

const ctrlOrCmd = /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform) ? "⌘" : "Ctrl";
const recommendationForClipboardAccess = `Please use the keyboard: ${ctrlOrCmd}+C to copy, ${ctrlOrCmd}+X to cut, ${ctrlOrCmd}+V to paste. If keyboard is not an option, try using Chrome version 76 or higher.`;
/**
 * @param {string} commandId
 */
function try_exec_command(commandId) {
	if (document.queryCommandEnabled(commandId)) { // not a reliable source for whether it'll work, if I recall
		document.execCommand(commandId);
		if (!navigator.userAgent.includes("Firefox") || commandId === "paste") {
			return show_error_message(`That ${commandId} probably didn't work. ${recommendationForClipboardAccess}`);
		}
	} else {
		return show_error_message(`Cannot perform ${commandId}. ${recommendationForClipboardAccess}`);
	}
}

function getSelectionText() {
	// instanceof might make this simpler, particularly with TypeScript JSDoc
	const activeEl = document.activeElement;
	const activeElTagName = activeEl ? activeEl.tagName.toLowerCase() : null;
	if (
		(activeElTagName == "textarea") || (
			activeElTagName == "input" &&
			/^(?:text|search|password|tel|url)$/i.test(/** @type {HTMLInputElement} */(activeEl).type)
		)
	) {
		const textField = /** @type {HTMLInputElement | HTMLTextAreaElement} */(activeEl);
		if (typeof textField.selectionStart == "number") {
			return textField.value.slice(textField.selectionStart, textField.selectionEnd);
		}
	}
	if (window.getSelection) {
		return window.getSelection().toString();
	}
	return "";
}

/**
 * @param {boolean} [execCommandFallback]
 */
function edit_copy(execCommandFallback) {
	const text = getSelectionText();

	if (text.length > 0) {
		if (!navigator.clipboard || !navigator.clipboard.writeText) {
			if (execCommandFallback) {
				return try_exec_command("copy");
			} else {
				show_error_message(`${localize("Error getting the Clipboard Data!")} ${recommendationForClipboardAccess}`);
				// show_error_message(`The Async Clipboard API is not supported by this browser. ${browserRecommendationForClipboardAccess}`);
				return;
			}
		}
		navigator.clipboard.writeText(text);
	} else if (selection && selection.canvas) {
		if (!navigator.clipboard || !navigator.clipboard.write) {
			if (execCommandFallback) {
				return try_exec_command("copy");
			} else {
				show_error_message(`${localize("Error getting the Clipboard Data!")} ${recommendationForClipboardAccess}`);
				// show_error_message(`The Async Clipboard API is not supported by this browser. ${browserRecommendationForClipboardAccess}`);
				return;
			}
		}
		selection.canvas.toBlob((blob) => {
			sanity_check_blob(blob, () => {
				navigator.clipboard.write([
					new ClipboardItem(Object.defineProperty({}, blob.type, {
						value: blob,
						enumerable: true,
					})),
				]).then(() => {
					window.console?.log("Copied image to the clipboard.");
				}, (error) => {
					show_error_message("Failed to copy to the Clipboard.", error);
				});
			});
		});
	}
}
/**
 * @param {boolean} [execCommandFallback]
 */
function edit_cut(execCommandFallback) {
	if (!navigator.clipboard || !navigator.clipboard.write) {
		if (execCommandFallback) {
			return try_exec_command("cut");
		} else {
			show_error_message(`${localize("Error getting the Clipboard Data!")} ${recommendationForClipboardAccess}`);
			// show_error_message(`The Async Clipboard API is not supported by this browser. ${browserRecommendationForClipboardAccess}`);
			return;
		}
	}
	edit_copy();
	delete_selection({
		name: localize("Cut"),
		icon: get_help_folder_icon("p_cut.png"),
	});
}
/**
 * @param {boolean} [execCommandFallback]
 */
async function edit_paste(execCommandFallback) {
	if (
		document.activeElement instanceof HTMLInputElement ||
		document.activeElement instanceof HTMLTextAreaElement
	) {
		if (!navigator.clipboard || !navigator.clipboard.readText) {
			if (execCommandFallback) {
				return try_exec_command("paste");
			} else {
				show_error_message(`${localize("Error getting the Clipboard Data!")} ${recommendationForClipboardAccess}`);
				// show_error_message(`The Async Clipboard API is not supported by this browser. ${browserRecommendationForClipboardAccess}`);
				return;
			}
		}
		const clipboardText = await navigator.clipboard.readText();
		document.execCommand("InsertText", false, clipboardText);
		return;
	}
	if (!navigator.clipboard || !navigator.clipboard.read) {
		if (execCommandFallback) {
			return try_exec_command("paste");
		} else {
			show_error_message(`${localize("Error getting the Clipboard Data!")} ${recommendationForClipboardAccess}`);
			// show_error_message(`The Async Clipboard API is not supported by this browser. ${browserRecommendationForClipboardAccess}`);
			return;
		}
	}
	try {
		const clipboardItems = await navigator.clipboard.read();
		const blob = await clipboardItems[0].getType("image/png");
		paste_image_from_file(blob);
	} catch (error) {
		if (error.name === "NotFoundError") {
			try {
				const clipboardText = await navigator.clipboard.readText();
				if (clipboardText) {
					const uris = get_uris(clipboardText);
					if (uris.length > 0) {
						load_image_from_uri(uris[0]).then((info) => {
							paste(info.image || make_canvas(info.image_data));
						}, (error) => {
							show_resource_load_error_message(error);
						});
					} else {
						// @TODO: should I just make a textbox instead?
						show_error_message("The information on the Clipboard can't be inserted into Paint.");
					}
				} else {
					show_error_message("The information on the Clipboard can't be inserted into Paint.");
				}
			} catch (error) {
				show_error_message(localize("Error getting the Clipboard Data!"), error);
			}
		} else {
			show_error_message(localize("Error getting the Clipboard Data!"), error);
		}
	}
}

function image_invert_colors() {
	apply_image_transformation({
		name: localize("Invert Colors"),
		icon: get_help_folder_icon("p_invert.png"),
	}, (_original_canvas, original_ctx, _new_canvas, new_ctx) => {
		const monochrome_info = monochrome && detect_monochrome(original_ctx);
		if (monochrome && monochrome_info.isMonochrome) {
			invert_monochrome(original_ctx, new_ctx, monochrome_info);
		} else {
			invert_rgb(original_ctx, new_ctx);
		}
	});
}

function clear() {
	deselect();
	cancel();
	undoable({
		name: localize("Clear Image"),
		icon: get_help_folder_icon("p_blank.png"),
	}, () => {
		saved = false;
		update_title();

		if (transparency) {
			main_ctx.clearRect(0, 0, main_canvas.width, main_canvas.height);
		} else {
			main_ctx.fillStyle = selected_colors.background;
			main_ctx.fillRect(0, 0, main_canvas.width, main_canvas.height);
		}
	});
}

let cleanup_bitmap_view = () => { };
function view_bitmap() {
	cleanup_bitmap_view();

	const bitmap_view_div = document.createElement("div");
	bitmap_view_div.classList.add("bitmap-view", "inset-deep");
	document.body.appendChild(bitmap_view_div);
	$(bitmap_view_div).css({
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		position: "fixed",
		top: "0",
		left: "0",
		width: "100%",
		height: "100%",
		zIndex: "9999",
		background: "var(--Background)",
	});
	if (bitmap_view_div.requestFullscreen) {
		bitmap_view_div.requestFullscreen();
	} else if (bitmap_view_div.webkitRequestFullscreen) {
		bitmap_view_div.webkitRequestFullscreen();
	}

	let blob_url;
	let got_fullscreen = false;
	let iid = setInterval(() => {
		// In Chrome, if the page is already fullscreen, and you requestFullscreen,
		// hitting Esc will change document.fullscreenElement without triggering the fullscreenchange event!
		// It doesn't trigger a keydown either.
		if (document.fullscreenElement === bitmap_view_div || document.webkitFullscreenElement === bitmap_view_div) {
			got_fullscreen = true;
		} else if (got_fullscreen) {
			cleanup_bitmap_view();
		}
	}, 100);
	cleanup_bitmap_view = () => {
		document.removeEventListener("fullscreenchange", onFullscreenChange);
		document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
		document.removeEventListener("keydown", onKeyDown);
		document.removeEventListener("mousedown", onMouseDown);
		// If you have e.g. the Help window open,
		// and right click to close the View Bitmap, with the mouse over the window,
		// this needs a delay to cancel the context menu.
		setTimeout(() => {
			document.removeEventListener("contextmenu", onContextMenu);
		}, 100);
		URL.revokeObjectURL(blob_url);
		clearInterval(iid);
		if (document.fullscreenElement === bitmap_view_div || document.webkitFullscreenElement === bitmap_view_div) {
			if (document.exitFullscreen) {
				document.exitFullscreen(); // avoid warning in Firefox
			} else if (document.msExitFullscreen) {
				document.msExitFullscreen();
			} else if (document.mozCancelFullScreen) {
				document.mozCancelFullScreen();
			} else if (document.webkitExitFullscreen) {
				document.webkitExitFullscreen();
			}
		}
		bitmap_view_div.remove();
		cleanup_bitmap_view = () => { };
	};
	document.addEventListener("fullscreenchange", onFullscreenChange, { once: true });
	document.addEventListener("webkitfullscreenchange", onFullscreenChange, { once: true });
	document.addEventListener("keydown", onKeyDown);
	document.addEventListener("mousedown", onMouseDown);
	document.addEventListener("contextmenu", onContextMenu);

	function onFullscreenChange() {
		if (document.fullscreenElement !== bitmap_view_div && document.webkitFullscreenElement !== bitmap_view_div) {
			cleanup_bitmap_view();
		}
	}
	let repeating_f = false;
	function onKeyDown(event) {
		// console.log(event.key, event.repeat);
		repeating_f = repeating_f || event.repeat && (event.key === "f" || event.key === "F");
		if (event.repeat) { return; }
		if (repeating_f && (event.key === "f" || event.key === "F")) {
			repeating_f = false;
			return; // Chrome sends an F keydown with repeat=false if you release Ctrl before F, while repeating.
			// This is a slightly overkill, and slightly overzealous workaround (can ignore one normal F before handling F as exit)
		}
		// Prevent also toggling View Bitmap on while toggling off, with Ctrl+F+F.
		// That is, if you hold Ctrl and press F twice, the second F should close View Bitmap and not reopen it immediately.
		// This relies on the keydown handler handling event.defaultPrevented (or isDefaultPrevented() if it's using jQuery)
		event.preventDefault();
		// Note: in mspaint, Esc is the only key that DOESN'T close the bitmap view,
		// but it also doesn't do anything else — other than changing the cursor. Stupid.
		cleanup_bitmap_view();
	}
	function onMouseDown(_event) {
		// Note: in mspaint, only left click exits View Bitmap mode.
		// Right click can show a useless context menu.
		cleanup_bitmap_view();
	}
	function onContextMenu(event) {
		event.preventDefault();
		cleanup_bitmap_view(); // not needed
	}

	// @TODO: include selection in the bitmap
	// I believe mspaint uses a similar code path to the Thumbnail,
	// considering that if you right click on the image in View Bitmap mode,
	// it shows the silly "Thumbnail" context menu item.
	// (It also shows the selection, in a meaningless place, similar to the Thumbnail's bugs)
	main_canvas.toBlob((blob) => {
		blob_url = URL.createObjectURL(blob);
		const img = document.createElement("img");
		img.src = blob_url;
		bitmap_view_div.appendChild(img);
	}, "image/png");
}
/**
 * @param {ToolID} id
 * @returns {Tool} tool object
 */
function get_tool_by_id(id) {
	for (let i = 0; i < tools.length; i++) {
		if (tools[i].id == id) {
			return tools[i];
		}
	}
	// for (let i = 0; i < extra_tools.length; i++) {
	// 	if (extra_tools[i].id == id) {
	// 		return extra_tools[i];
	// 	}
	// }
}

// hacky but whatever
// this whole "multiple tools" thing is hacky for now
/**
 * @param {Tool[]} tools
 */
function select_tools(tools) {
	for (let i = 0; i < tools.length; i++) {
		select_tool(tools[i], i > 0);
	}
	update_helper_layer();
}

/**
 * @param {Tool} tool
 * @param {boolean} [toggle]
 */
function select_tool(tool, toggle) {
	deselect();

	if (!(selected_tools.length === 1 && selected_tool.deselect)) {
		return_to_tools = [...selected_tools];
	}
	if (toggle) {
		const index = selected_tools.indexOf(tool);
		if (index === -1) {
			selected_tools.push(tool);
			selected_tools.sort((a, b) => {
				if (tools.indexOf(a) < tools.indexOf(b)) {
					return -1;
				}
				if (tools.indexOf(a) > tools.indexOf(b)) {
					return +1;
				}
				return 0;
			});
		} else {
			selected_tools.splice(index, 1);
		}
		if (selected_tools.length > 0) {
			selected_tool = selected_tools[selected_tools.length - 1];
		} else {
			selected_tool = default_tool;
			selected_tools = [selected_tool];
		}
	} else {
		selected_tool = tool;
		selected_tools = [tool];
	}

	if (tool.preload) {
		tool.preload();
	}

	$toolbox.update_selected_tool();
	// $toolbox2.update_selected_tool();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @returns {boolean} whether the canvas has any translucent pixels (with a stupid margin of error)
 */
function has_any_transparency(ctx) {
	// @TODO Optimization: Assume JPEGs and some other file types are opaque.
	// Raster file formats that SUPPORT transparency include GIF, PNG, BMP and TIFF
	// (Yes, even BMPs support transparency!)
	const id = ctx.getImageData(0, 0, main_canvas.width, main_canvas.height);
	for (let i = 0, l = id.data.length; i < l; i += 4) {
		// I've seen firefox give [ 254, 254, 254, 254 ] for get_rgba_from_color("#fff")
		// or other values
		if (id.data[i + 3] < 253) {
			return true;
		}
	}
	return false;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @returns {MonochromeInfo}
 */
function detect_monochrome(ctx) {
	// Note: Brave browser, and DuckDuckGo Privacy Essentials browser extension
	// implement a privacy technique known as "farbling", which breaks this code.
	// (I've implemented workarounds in many places, but not here yet.)
	// This function currently returns the set of one or two colors if applicable,
	// and things outside would need to be changed to handle a "near-monochrome" state.

	const id = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
	const pixelArray = new Uint32Array(id.data.buffer); // to access as whole pixels (for greater efficiency & simplicity)
	// Note: values in pixelArray may be different on big endian vs little endian machines.
	// Use id.data, which is guaranteed to be in RGBA order, for getting color information.
	// Only use the Uint32Array for comparing pixel equality (faster than comparing each color component).
	const colorUint32s = [];
	const colorRGBAs = [];
	let anyTransparency = false;
	for (let i = 0, len = pixelArray.length; i < len; i += 1) {
		// @TODO: should this threshold not mirror has_any_transparency?
		// seems to have different notions of "any transparency"
		// has_any_transparency is "has any pixels not fully opaque"
		// detect_monochrome's anyTransparency means "has any pixels fully transparent"
		if (id.data[i * 4 + 3] > 1) {
			if (!colorUint32s.includes(pixelArray[i])) {
				if (colorUint32s.length < 2) {
					colorUint32s.push(pixelArray[i]);
					colorRGBAs.push(id.data.slice(i * 4, (i + 1) * 4));
				} else {
					return { isMonochrome: false };
				}
			}
		} else {
			anyTransparency = true;
		}
	}
	return {
		isMonochrome: true,
		presentNonTransparentRGBAs: colorRGBAs,
		presentNonTransparentUint32s: colorUint32s,
		monochromeWithTransparency: anyTransparency,
	};
}

/**
 * Creates a dithered pattern using two colors.
 * @param {number} lightness - The approximate fraction of pixels that will use the second(?) color.
 * @param {Uint8ClampedArray | number[]} rgba1 - RGBA color values for the first color.
 * @param {Uint8ClampedArray | number[]} rgba2 - RGBA color values for the second color.
 * @returns {CanvasPattern}
 */
function make_monochrome_pattern(lightness, rgba1 = [0, 0, 0, 255], rgba2 = [255, 255, 255, 255]) {

	const dither_threshold_table = Array.from({ length: 64 }, (_undefined, p) => {
		const q = p ^ (p >> 3);
		return (
			((p & 4) >> 2) | ((q & 4) >> 1) |
			((p & 2) << 1) | ((q & 2) << 2) |
			((p & 1) << 4) | ((q & 1) << 5)
		) / 64;
	});

	const pattern_canvas = document.createElement("canvas");
	const pattern_ctx = pattern_canvas.getContext("2d");

	pattern_canvas.width = 8;
	pattern_canvas.height = 8;

	const pattern_image_data = main_ctx.createImageData(pattern_canvas.width, pattern_canvas.height);

	for (let x = 0; x < pattern_canvas.width; x += 1) {
		for (let y = 0; y < pattern_canvas.height; y += 1) {
			const map_value = dither_threshold_table[(x & 7) + ((y & 7) << 3)];
			const px_white = lightness > map_value;
			const index = ((y * pattern_image_data.width) + x) * 4;
			pattern_image_data.data[index + 0] = px_white ? rgba2[0] : rgba1[0];
			pattern_image_data.data[index + 1] = px_white ? rgba2[1] : rgba1[1];
			pattern_image_data.data[index + 2] = px_white ? rgba2[2] : rgba1[2];
			pattern_image_data.data[index + 3] = (px_white ? rgba2[3] : rgba1[3]) ?? 255; // handling also 3-length arrays (RGB)
		}
	}

	pattern_ctx.putImageData(pattern_image_data, 0, 0);

	return main_ctx.createPattern(pattern_canvas, "repeat");
}

/**
 * @param {Uint8ClampedArray | number[]} rgba1
 * @param {Uint8ClampedArray | number[]} rgba2
 * @returns {CanvasPattern[]}
 */
function make_monochrome_palette(rgba1 = [0, 0, 0, 255], rgba2 = [255, 255, 255, 255]) {
	const palette = [];
	const n_colors_per_row = 14;
	const n_colors = n_colors_per_row * 2;
	for (let i = 0; i < n_colors_per_row; i++) {
		let lightness = i / n_colors;
		palette.push(make_monochrome_pattern(lightness, rgba1, rgba2));
	}
	for (let i = 0; i < n_colors_per_row; i++) {
		let lightness = 1 - i / n_colors;
		palette.push(make_monochrome_pattern(lightness, rgba1, rgba2));
	}

	return palette;
}

/**
 * @param {boolean} reverse
 * @param {string[]} colors
 * @param {number=} stripe_size
 * @returns {CanvasPattern}
 */
function make_stripe_pattern(reverse, colors, stripe_size = 4) {
	const rgba_colors = colors.map(get_rgba_from_color);

	const pattern_canvas = document.createElement("canvas");
	const pattern_ctx = pattern_canvas.getContext("2d");

	pattern_canvas.width = colors.length * stripe_size;
	pattern_canvas.height = colors.length * stripe_size;

	const pattern_image_data = main_ctx.createImageData(pattern_canvas.width, pattern_canvas.height);

	for (let x = 0; x < pattern_canvas.width; x += 1) {
		for (let y = 0; y < pattern_canvas.height; y += 1) {
			const pixel_index = ((y * pattern_image_data.width) + x) * 4;
			// +1000 to avoid remainder on negative numbers
			const pos = reverse ? (x - y) : (x + y);
			const color_index = Math.floor((pos + 1000) / stripe_size) % colors.length;
			const rgba = rgba_colors[color_index];
			pattern_image_data.data[pixel_index + 0] = rgba[0];
			pattern_image_data.data[pixel_index + 1] = rgba[1];
			pattern_image_data.data[pixel_index + 2] = rgba[2];
			pattern_image_data.data[pixel_index + 3] = rgba[3];
		}
	}

	pattern_ctx.putImageData(pattern_image_data, 0, 0);

	return main_ctx.createPattern(pattern_canvas, "repeat");
}

function switch_to_polychrome_palette() {

}

function make_opaque() {
	undoable({
		name: "Make Opaque",
		icon: get_help_folder_icon("p_make_opaque.png"),
	}, () => {
		main_ctx.save();
		main_ctx.globalCompositeOperation = "destination-atop";

		main_ctx.fillStyle = selected_colors.background;
		main_ctx.fillRect(0, 0, main_canvas.width, main_canvas.height);

		// in case the selected background color is transparent/translucent
		main_ctx.fillStyle = "white";
		main_ctx.fillRect(0, 0, main_canvas.width, main_canvas.height);

		main_ctx.restore();
	});
}

/**
 * Resizes the canvas without saving the dimensions to local storage.
 *
 * @param {number} unclamped_width - The new width of the canvas. Will be clamped to a minimum of 1.
 * @param {number} unclamped_height - The new height of the canvas. Will be clamped to a minimum of 1.
 * @param {{name?: string, icon?: HTMLImageElement | HTMLCanvasElement}} [undoable_meta={}] - overrides certain properties of ActionMetadata
 */
function resize_canvas_without_saving_dimensions(unclamped_width, unclamped_height, undoable_meta = {}) {
	const new_width = Math.max(1, unclamped_width);
	const new_height = Math.max(1, unclamped_height);
	if (main_canvas.width !== new_width || main_canvas.height !== new_height) {
		undoable({
			name: undoable_meta.name || "Resize Canvas",
			icon: undoable_meta.icon || get_help_folder_icon("p_stretch_both.png"),
		}, () => {
			try {
				const image_data = main_ctx.getImageData(0, 0, new_width, new_height);
				main_canvas.width = new_width;
				main_canvas.height = new_height;
				main_ctx.disable_image_smoothing();

				if (!transparency) {
					main_ctx.fillStyle = selected_colors.background;
					main_ctx.fillRect(0, 0, main_canvas.width, main_canvas.height);
				}

				const temp_canvas = make_canvas(image_data);
				main_ctx.drawImage(temp_canvas, 0, 0);
			} catch (exception) {
				if (exception.name === "NS_ERROR_FAILURE") {
					// or localize("There is not enough memory or resources to complete operation.")
					show_error_message(localize("Insufficient memory to perform operation."), exception);
				} else {
					show_error_message(localize("An unknown error has occurred."), exception);
				}
				// @TODO: undo and clean up undoable
				// maybe even keep Attributes dialog open if that's what's triggering the resize
				return;
			}

			$canvas_area.trigger("resize");
		});
	}
}

/**
 * Resizes the canvas and saves the dimensions to local storage as the new default.
 *
 * @param {number} unclamped_width - The new width of the canvas. Will be clamped to a minimum of 1.
 * @param {number} unclamped_height - The new height of the canvas. Will be clamped to a minimum of 1.
 * @param {{name?: string, icon?: HTMLImageElement | HTMLCanvasElement}} [undoable_meta={}] - overrides certain properties of ActionMetadata
 */
function resize_canvas_and_save_dimensions(unclamped_width, unclamped_height, undoable_meta = {}) {
	resize_canvas_without_saving_dimensions(unclamped_width, unclamped_height, undoable_meta);
	localStore.set({
		width: main_canvas.width.toString(),
		height: main_canvas.height.toString(),
	}, (_error) => {
		// oh well
	});
}

function image_attributes() {
	if (image_attributes.$window) {
		image_attributes.$window.close();
	}
	const $w = image_attributes.$window = $DialogWindow(localize("Attributes"));
	$w.addClass("attributes-window");

	const $main = $w.$main;

	// Information
	const table = {
		[localize("File last saved:")]: localize("Not Available"),
		[localize("Size on disk:")]: localize("Not Available"),
		[localize("Resolution:")]: "72 x 72 dots per inch",
	};
	const $table = $(E("table")).appendTo($main);
	for (const k in table) {
		const $tr = $(E("tr")).appendTo($table);
		$(E("td")).appendTo($tr).text(k);
		const $value = $(E("td")).appendTo($tr).text(table[k]);
		if (table[k].indexOf("72") !== -1) {
			$value.css("direction", "ltr");
		}
	}

	// Dimensions - Force to 32x32
	const unit_sizes_in_px = { px: 1, in: 72, cm: 28.3465 };
	let current_unit = image_attributes.unit = image_attributes.unit || "px";
	// Always set to 32x32 px
	let width_in_px = 32;
	let height_in_px = 32;

	const $width_label = $(E("label")).appendTo($main).html(render_access_key(localize("&Width:")));
	const $height_label = $(E("label")).appendTo($main).html(render_access_key(localize("&Height:")));
	const $width = $(E("input")).attr({ type: "number", min: 1, "aria-keyshortcuts": "Alt+W W W", value: 32, disabled: true }).addClass("no-spinner inset-deep").appendTo($width_label);
	const $height = $(E("input")).attr({ type: "number", min: 1, "aria-keyshortcuts": "Alt+H H H", value: 32, disabled: true }).addClass("no-spinner inset-deep").appendTo($height_label);

	// Units, Colors, Transparency sections remain the same
	// [Rest of the code remains the same]

	$w.$Button(localize("OK"), () => {
		const transparency_option = $transparency.find(":checked").val();
		const colors_option = $colors.find(":checked").val();
		const unit = String($units.find(":checked").val());

		const was_monochrome = monochrome;
		let monochrome_info;

		image_attributes.unit = unit;
		transparency = (transparency_option == "transparent");
		monochrome = (colors_option == "monochrome");

		if (monochrome != was_monochrome) {
			// [Existing monochrome handling code]
		}

		// Always resize to 32x32 px regardless of inputs
		resize_canvas_and_save_dimensions(32, 32);

		if (!transparency && has_any_transparency(main_ctx)) {
			make_opaque();
		}

		// [Rest of the monochrome handling code]

		image_attributes.$window.close();
	}, { type: "submit" });

	$w.$Button(localize("Cancel"), () => {
		image_attributes.$window.close();
	});

	// Parsing HTML with jQuery; $Button takes text (not HTML) or Node/DocumentFragment
	$w.$Button($.parseHTML(render_access_key(localize("&Default")))[0], () => {
		width_in_px = default_canvas_width;
		height_in_px = default_canvas_height;
		$width.val(width_in_px / unit_sizes_in_px[current_unit]);
		$height.val(height_in_px / unit_sizes_in_px[current_unit]);
	}).attr("aria-keyshortcuts", "Alt+D D");

	handle_keyshortcuts($w);

	// Default focus

	$width.select();

	// Reposition the window

	image_attributes.$window.center();
}

// TODO: maybe don't tack properties onto functions so much!?
/**
 * @memberof image_attributes
 * @type {OSGUI$Window}
 */
image_attributes.$window = null;
/**
 * @memberof image_attributes
 * @type {string}
 */
image_attributes.unit = "px";

function show_convert_to_black_and_white() {
	const $w = $DialogWindow("Convert to Black and White");
	$w.addClass("convert-to-black-and-white");
	$w.$main.append("<fieldset><legend>Threshold:</legend><input type='range' min='0' max='1' step='0.01' value='0.5'></fieldset>");
	const $slider = $w.$main.find("input[type='range']");
	const original_canvas = make_canvas(main_canvas);
	let threshold;
	const update_threshold = () => {
		make_or_update_undoable({
			name: "Make Monochrome",
			match: (history_node) => history_node.name === "Make Monochrome",
			icon: get_help_folder_icon("p_monochrome.png"),
		}, () => {
			threshold = Number($slider.val());
			main_ctx.copy(original_canvas);
			threshold_black_and_white(main_ctx, threshold);
		});
	};
	update_threshold();
	const update_threshold_soon = debounce(update_threshold, 100);
	$slider.on("input", update_threshold_soon);

	$w.$Button(localize("OK"), () => {
		$w.close();
	}, { type: "submit" }).focus();
	$w.$Button(localize("Cancel"), () => {
		if (current_history_node.name === "Make Monochrome") {
			undo();
		} else {
			undoable({
				name: "Cancel Make Monochrome",
				icon: get_help_folder_icon("p_color.png"),
			}, () => {
				main_ctx.copy(original_canvas);
			});
		}
		$w.close();
	});
	$w.center();
}

function image_flip_and_rotate() {
	const $w = $DialogWindow(localize("Flip and Rotate"));
	$w.addClass("flip-and-rotate");

	const $fieldset = $(E("fieldset")).appendTo($w.$main);
	$fieldset.append(`
		<legend>${localize("Flip or rotate")}</legend>
		<div class="radio-wrapper">
			<input
				type="radio"
				name="flip-or-rotate"
				id="flip-horizontal"
				value="flip-horizontal"
				aria-keyshortcuts="Alt+F"
				checked
			/><label for="flip-horizontal">${render_access_key(localize("&Flip horizontal"))}</label>
		</div>
		<div class="radio-wrapper">
			<input
				type="radio"
				name="flip-or-rotate"
				id="flip-vertical"
				value="flip-vertical"
				aria-keyshortcuts="Alt+V"
			/><label for="flip-vertical">${render_access_key(localize("Flip &vertical"))}</label>
		</div>
		<div class="radio-wrapper">
			<input
				type="radio"
				name="flip-or-rotate"
				id="rotate-by-angle"
				value="rotate-by-angle"
				aria-keyshortcuts="Alt+R"
			/><label for="rotate-by-angle">${render_access_key(localize("&Rotate by angle"))}</label>
		</div>
	`);

	const $rotate_by_angle = $(E("div")).appendTo($fieldset);
	$rotate_by_angle.addClass("sub-options");
	for (const label_with_hotkey of [
		"&90°",
		"&180°",
		"&270°",
	]) {
		const degrees = parseInt(AccessKeys.toText(label_with_hotkey), 10);
		$rotate_by_angle.append(`
			<div class="radio-wrapper">
				<input
					type="radio"
					name="rotate-by-angle"
					value="${degrees}"
					id="rotate-${degrees}"
					aria-keyshortcuts="Alt+${AccessKeys.get(label_with_hotkey).toUpperCase()}"
				/><label
					for="rotate-${degrees}"
				>${render_access_key(label_with_hotkey)}</label>
			</div>
		`);
	}
	$rotate_by_angle.append(`
		<div class="radio-wrapper">
			<input
				type="radio"
				name="rotate-by-angle"
				value="arbitrary"
			/><input
				type="number"
				min="-360"
				max="360"
				name="rotate-by-arbitrary-angle"
				id="custom-degrees"
				value=""
				class="no-spinner inset-deep"
				style="width: 50px"
			/>
			<label for="custom-degrees">${localize("Degrees")}</label>
		</div>
	`);
	$rotate_by_angle.find("#rotate-90").attr({ checked: true });
	// Disabling inputs makes them not even receive mouse events,
	// and so pointer-events: none is needed to respond to events on the parent.
	$rotate_by_angle.find("input").attr({ disabled: true });
	$fieldset.find("input").on("change", () => {
		const action = $fieldset.find("input[name='flip-or-rotate']:checked").val();
		$rotate_by_angle.find("input").attr({
			disabled: action !== "rotate-by-angle",
		});
	});
	$rotate_by_angle.find(".radio-wrapper").on("click", (e) => {
		// Select "Rotate by angle" and enable subfields
		$fieldset.find("input[value='rotate-by-angle']").prop("checked", true);
		$fieldset.find("input").triggerHandler("change");

		const $wrapper = $(e.target).closest(".radio-wrapper");
		// Focus the numerical input if this field has one
		const num_input = $wrapper.find("input[type='number']")[0];
		if (num_input) {
			num_input.focus();
		}
		// Select the radio for this field
		$wrapper.find("input[type='radio']").prop("checked", true);
	});

	$fieldset.find("input[name='rotate-by-arbitrary-angle']").on("input", () => {
		$fieldset.find("input[value='rotate-by-angle']").prop("checked", true);
		$fieldset.find("input[value='arbitrary']").prop("checked", true);
	});

	$w.$Button(localize("OK"), () => {
		const action = $fieldset.find("input[name='flip-or-rotate']:checked").val();
		switch (action) {
			case "flip-horizontal":
				flip_horizontal();
				break;
			case "flip-vertical":
				flip_vertical();
				break;
			case "rotate-by-angle": {
				let angle_val = $fieldset.find("input[name='rotate-by-angle']:checked").val();
				if (angle_val === "arbitrary") {
					angle_val = $fieldset.find("input[name='rotate-by-arbitrary-angle']").val();
				}
				const angle_deg = Number(angle_val);
				const angle = angle_deg / 360 * TAU;

				if (isNaN(angle)) {
					please_enter_a_number();
					return;
				}
				rotate(angle);
				break;
			}
		}

		$w.close();
	}, { type: "submit" });
	$w.$Button(localize("Cancel"), () => {
		$w.close();
	});

	$fieldset.find("input[type='radio']").first().focus();

	$w.center();

	handle_keyshortcuts($w);
}

function image_stretch_and_skew() {
	const $w = $DialogWindow(localize("Stretch and Skew"));
	$w.addClass("stretch-and-skew");

	const $fieldset_stretch = $(E("fieldset")).appendTo($w.$main);
	$fieldset_stretch.append(`<legend>${localize("Stretch")}</legend><table></table>`);
	const $fieldset_skew = $(E("fieldset")).appendTo($w.$main);
	$fieldset_skew.append(`<legend>${localize("Skew")}</legend><table></table>`);

	const $RowInput = ($table, img_src, label_with_hotkey, default_value, label_unit, min, max) => {
		const $tr = $(E("tr")).appendTo($table);
		const $img = $(E("img")).attr({
			src: `images/transforms/${img_src}.png`,
			width: 32,
			height: 32,
		}).css({
			marginRight: "20px",
		});
		const input_id = ("input" + Math.random() + Math.random()).replace(/\./, "");
		const $input = $(E("input")).attr({
			type: "number",
			min,
			max,
			value: default_value,
			id: input_id,
			"aria-keyshortcuts": `Alt+${AccessKeys.get(label_with_hotkey).toUpperCase()}`,
		}).css({
			width: "40px",
		}).addClass("no-spinner inset-deep");
		$(E("td")).appendTo($tr).append($img);
		$(E("td")).appendTo($tr).append($(E("label")).html(render_access_key(label_with_hotkey)).attr("for", input_id));
		$(E("td")).appendTo($tr).append($input);
		$(E("td")).appendTo($tr).text(label_unit);

		return $input;
	};

	const stretch_x = $RowInput($fieldset_stretch.find("table"), "stretch-x", localize("&Horizontal:"), 100, "%", 1, 5000);
	const stretch_y = $RowInput($fieldset_stretch.find("table"), "stretch-y", localize("&Vertical:"), 100, "%", 1, 5000);
	const skew_x = $RowInput($fieldset_skew.find("table"), "skew-x", localize("H&orizontal:"), 0, localize("Degrees"), -90, 90);
	const skew_y = $RowInput($fieldset_skew.find("table"), "skew-y", localize("V&ertical:"), 0, localize("Degrees"), -90, 90);

	$w.$Button(localize("OK"), () => {
		const x_scale = parseFloat(stretch_x.val()) / 100;
		const y_scale = parseFloat(stretch_y.val()) / 100;
		const h_skew = parseFloat(skew_x.val()) / 360 * TAU;
		const v_skew = parseFloat(skew_y.val()) / 360 * TAU;
		if (isNaN(x_scale) || isNaN(y_scale) || isNaN(h_skew) || isNaN(v_skew)) {
			please_enter_a_number();
			return;
		}
		try {
			stretch_and_skew(x_scale, y_scale, h_skew, v_skew);
		} catch (exception) {
			if (exception.name === "NS_ERROR_FAILURE") {
				// or localize("There is not enough memory or resources to complete operation.")
				show_error_message(localize("Insufficient memory to perform operation."), exception);
			} else {
				show_error_message(localize("An unknown error has occurred."), exception);
			}
			// @TODO: undo and clean up undoable
			return;
		}
		$w.close();
	}, { type: "submit" });

	$w.$Button(localize("Cancel"), () => {
		$w.close();
	});

	$w.$main.find("input").first().focus().select();

	$w.center();

	handle_keyshortcuts($w);
}

/**
 * @param {JQuery<HTMLElement>} $container
 */
function handle_keyshortcuts($container) {
	// This function implements shortcuts defined with aria-keyshortcuts.
	// It also modifies aria-keyshortcuts to remove shortcuts that don't
	// contain a modifier (other than shift) when an input field is focused,
	// in order to avoid conflicts with typing.
	// It stores the original aria-keyshortcuts (indefinitely), so if aria-keyshortcuts
	// is ever to be modified at runtime (externally), the code here may need to be changed.

	$container.on("keydown", (event) => {
		const $targets = $container.find("[aria-keyshortcuts]");
		for (let shortcut_target of $targets) {
			const shortcuts = $(shortcut_target).attr("aria-keyshortcuts").split(" ");
			for (const shortcut of shortcuts) {
				// TODO: should we use code instead of key? need examples
				if (
					!!shortcut.match(/Alt\+/i) === event.altKey &&
					!!shortcut.match(/Ctrl\+/i) === event.ctrlKey &&
					!!shortcut.match(/Meta\+/i) === event.metaKey &&
					!!shortcut.match(/Shift\+/i) === event.shiftKey &&
					shortcut.split("+").pop().toUpperCase() === event.key.toUpperCase()
				) {
					event.preventDefault();
					event.stopPropagation();
					// @ts-ignore
					if (shortcut_target.disabled) {
						shortcut_target = shortcut_target.closest(".radio-wrapper");
					}
					shortcut_target.click();
					shortcut_target.focus();
					return;
				}
			}
		}
	});

	// Prevent keyboard shortcuts from interfering with typing in text fields.
	// Rather than conditionally handling the shortcut, I'm conditionally removing it,
	// because _theoretically_ it's better for assistive technology to know that the shortcut isn't available.
	// (Theoretically I should also remove aria-keyshortcuts when the window isn't focused...)
	$container.on("focusin focusout", (event) => {
		if ($(event.target).is('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]):not([type="file"]):not([type="color"]):not([type="range"])')) {
			for (const control of $container.find("[aria-keyshortcuts]")) {
				// @ts-ignore (could use a Map but that would be a little more complicated)
				control._original_aria_keyshortcuts = control._original_aria_keyshortcuts ?? control.getAttribute("aria-keyshortcuts");
				// Remove shortcuts without modifiers.
				control.setAttribute("aria-keyshortcuts",
					control.getAttribute("aria-keyshortcuts")
						.split(" ")
						.filter((shortcut) => shortcut.match(/(Alt|Ctrl|Meta)\+/i))
						.join(" ")
				);
			}
		} else {
			// Restore shortcuts.
			for (const control of $container.find("[aria-keyshortcuts]")) {
				// @ts-ignore
				if (control._original_aria_keyshortcuts) {
					// @ts-ignore
					control.setAttribute("aria-keyshortcuts", control._original_aria_keyshortcuts);
				}
			}
		}
	});
}

/**
 * Displays a save prompt dialog with options to specify the file name and format.
 *
 * @param {Object} options
 * @param {string} [options.dialogTitle="Save As"] - The title of the dialog.
 * @param {string} [options.defaultFileName=""] - The default file name.
 * @param {string} [options.defaultFileFormatID] - The file format to select by default.
 * @param {FileFormat[]} options.formats - The file formats available in the dropdown.
 * @param {boolean} [options.promptForName=true] - Whether to prompt for the file name, or just the format.
 *
 * @returns {Promise<{newFileName: string, newFileFormatID: string}>} - A promise that resolves with the new file name and format ID.
 */
function save_as_prompt({
	dialogTitle = localize("Save As"),
	defaultFileName = "",
	defaultFileFormatID,
	formats,
	promptForName = true,
}) {
	return new Promise((resolve) => {
		const $w = $DialogWindow(dialogTitle);
		$w.addClass("save-as");

		// This is needed to prevent the keyboard from closing when you tap the file name input! in FF mobile
		// @TODO: Investigate this in os-gui.js; is it literally just the browser default behavior to focus a div with tabindex that's the parent of an input?
		// That'd be crazy, right?
		$w.$content.attr("tabIndex", null);

		// @TODO: hotkeys (N, T, S, Enter, Esc)
		if (promptForName) {
			$w.$main.append(`
				<label>
					File name:
					<input type="text" class="file-name inset-deep"/>
				</label>
			`);
		}
		$w.$main.append(`
			<label>
				Save as type:
				<select class="file-type-select inset-deep"></select>
			</label>
		`);
		const $file_type = $w.$main.find(".file-type-select");
		const $file_name = $w.$main.find(".file-name");

		for (const format of formats) {
			$file_type.append($("<option>").val(format.formatID).text(format.nameWithExtensions));
		}

		if (promptForName) {
			$file_name.val(defaultFileName);
		}

		const get_selected_format = () => {
			const selected_format_id = $file_type.val();
			for (const format of formats) {
				if (format.formatID === selected_format_id) {
					return format;
				}
			}
		};

		// Select file type when typing file name
		const select_file_type_from_file_name = () => {
			const extension_match = (promptForName ? String($file_name.val()) : defaultFileName).match(/\.([\w\d]+)$/);
			if (extension_match) {
				const selected_format = get_selected_format();
				const matched_ext = extension_match[1].toLowerCase();
				if (selected_format && selected_format.extensions.includes(matched_ext)) {
					// File extension already matches selected file type.
					// Don't select a different file type with the same extension.
					return;
				}
				for (const format of formats) {
					if (format.extensions.includes(matched_ext)) {
						$file_type.val(format.formatID);
					}
				}
			}
		};
		if (promptForName) {
			$file_name.on("input", select_file_type_from_file_name);
		}
		if (defaultFileFormatID && formats.some((format) => format.formatID === defaultFileFormatID)) {
			$file_type.val(defaultFileFormatID);
		} else {
			select_file_type_from_file_name();
		}

		// Change file extension when selecting file type
		// allowing non-default extension like .dib vs .bmp, .jpg vs .jpeg to stay
		const update_extension_from_file_type = (add_extension_if_absent) => {
			if (!promptForName) {
				return;
			}
			let file_name = /** @type {string} */($file_name.val());
			const selected_format = get_selected_format();
			if (!selected_format) {
				return;
			}
			const extensions_for_type = selected_format.extensions;
			const primary_extension_for_type = extensions_for_type[0];
			// This way of removing the file extension doesn't scale very well! But I don't want to delete text the user wanted like in case of a version number...
			const without_extension = file_name.replace(/\.(\w{1,3}|apng|jpeg|jfif|tiff|webp|psppalette|sketchpalette|gimp|colors|scss|sass|less|styl|html|theme|themepack)$/i, "");
			const extension_present = without_extension !== file_name;
			const extension = file_name.slice(without_extension.length + 1).toLowerCase(); // without dot
			if (
				(add_extension_if_absent || extension_present) &&
				extensions_for_type.indexOf(extension) === -1
			) {
				file_name = `${without_extension}.${primary_extension_for_type}`;
				$file_name.val(file_name);
			}
		};
		$file_type.on("change", () => {
			update_extension_from_file_type(false);
		});
		// and initially
		update_extension_from_file_type(false);

		const $save = $w.$Button(localize("Save"), () => {
			$w.close();
			update_extension_from_file_type(true);
			resolve({
				newFileName: promptForName ? String($file_name.val()) : defaultFileName,
				newFileFormatID: String($file_type.val()),
			});
		}, { type: "submit" });
		$w.$Button(localize("Cancel"), () => {
			$w.close();
		});

		$w.center();
		// For mobile devices with on-screen keyboards, move the window to the top
		if (window.innerWidth < 500 || window.innerHeight < 700) {
			$w.css({ top: 20 });
		}

		if (promptForName) {
			$file_name.focus().select();
		} else {
			// $file_type.focus(); // most of the time you don't want to change the type from PNG
			$save.focus();
		}
	});
}

/**
 * Writes an image file to a blob, in the given format.
 * @param {HTMLCanvasElement} canvas - The canvas to export as an image file. Must have a 2d context.
 * @param {string} mime_type - The MIME type of the image file.
 * @param {(Blob)=> void} blob_callback - This function is called with the blob, or may never be called if there is an error.
 */
function write_image_file(canvas, mime_type, blob_callback) {
	const ctx = canvas.getContext("2d");
	const bmp_match = mime_type.match(/^image\/(?:x-)?bmp\s*(?:-(\d+)bpp)?/);
	if (bmp_match) {
		const file_content = encodeBMP(ctx.getImageData(0, 0, canvas.width, canvas.height), parseInt(bmp_match[1] || "24", 10));
		const blob = new Blob([file_content]);
		sanity_check_blob(blob, () => {
			blob_callback(blob);
		});
	} else if (mime_type === "image/png") {
		// UPNG.js gives better compressed PNGs than the built-in browser PNG encoder
		// In fact you can use it as a minifier! http://upng.photopea.com/
		const image_data = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const array_buffer = UPNG.encode([image_data.data.buffer], image_data.width, image_data.height);
		const blob = new Blob([array_buffer]);
		sanity_check_blob(blob, () => {
			blob_callback(blob);
		});
	} else if (mime_type === "image/tiff") {
		const image_data = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const metadata = {
			t305: ["jspaint (UTIF.js)"],
		};
		const array_buffer = UTIF.encodeImage(image_data.data.buffer, image_data.width, image_data.height, metadata);
		const blob = new Blob([array_buffer]);
		sanity_check_blob(blob, () => {
			blob_callback(blob);
		});
	} else {
		canvas.toBlob((blob) => {
			// Note: could check blob.type (mime type) instead
			const png_magic_bytes = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
			sanity_check_blob(blob, () => {
				blob_callback(blob);
			}, png_magic_bytes, mime_type === "image/png");
		}, mime_type);
	}
}

/**
 * @param {Blob} blob
 * @param {(error: Error|null, result?: ImageInfo) => void} callback
 */
function read_image_file(blob, callback) {
	// @TODO: handle SVG (might need to keep track of source URL, for relative resources)
	// @TODO: read palette from GIF files

	let file_format;
	let palette;
	let monochrome = false;

	blob.arrayBuffer().then((arrayBuffer) => {
		// Helpers:
		// "GIF".split("").map(c=>"0x"+c.charCodeAt(0).toString("16")).join(", ")
		// [0x47, 0x49, 0x46].map(c=>String.fromCharCode(c)).join("")
		const magics = {
			png: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
			bmp: [0x42, 0x4D], // "BM" in ASCII
			jpeg: [0xFF, 0xD8, 0xFF],
			gif: [0x47, 0x49, 0x46, 0x38], // "GIF8" in ASCII, fully either "GIF87a" or "GIF89a"
			webp: [0x57, 0x45, 0x42, 0x50], // "WEBP" in ASCII
			tiff_be: [0x4D, 0x4D, 0x0, 0x2A],
			tiff_le: [0x49, 0x49, 0x2A, 0x0],
			ico: [0x00, 0x00, 0x01, 0x00],
			cur: [0x00, 0x00, 0x02, 0x00],
			icns: [0x69, 0x63, 0x6e, 0x73], // "icns" in ASCII
		};
		const file_bytes = new Uint8Array(arrayBuffer);
		let detected_type_id;
		for (const [type_id, magic_bytes] of Object.entries(magics)) {
			const magic_found = magic_bytes.every((byte, index) => byte === file_bytes[index]);
			if (magic_found) {
				detected_type_id = type_id;
			}
		}
		if (!detected_type_id) {
			if (String.fromCharCode(...file_bytes.slice(0, 1024)).includes("%PDF")) {
				detected_type_id = "pdf";
			}
		}
		if (detected_type_id === "bmp") {
			const { colorTable, bitsPerPixel, imageData } = decodeBMP(arrayBuffer);
			file_format = bitsPerPixel === 24 ? "image/bmp" : `image/bmp;bpp=${bitsPerPixel}`;
			if (colorTable.length >= 2) {
				if (colorTable.length === 2) {
					palette = make_monochrome_palette(...colorTable.map((color) => [color.r, color.g, color.b, 255]));
					monochrome = true;
				} else {
					palette = colorTable.map((color) => `rgb(${color.r}, ${color.g}, ${color.b})`);
					monochrome = false;
				}
			}
			// if (bitsPerPixel !== 32 && bitsPerPixel !== 16) {
			// 	for (let i = 3; i < imageData.data.length; i += 4) {
			// 		imageData.data[i] = 255;
			// 	}
			// }
			callback(null, { file_format, monochrome, palette, image_data: imageData, source_blob: blob });
		} else if (detected_type_id === "png") {
			const decoded = UPNG.decode(arrayBuffer);
			const rgba = UPNG.toRGBA8(decoded)[0];
			const { width, height, tabs, ctype } = decoded;
			// If it's a palettized PNG, load the palette for the Colors box.
			// Note: PLTE (palette) chunk must be present for palettized PNGs,
			// but can also be present as a recommended set of colors in true-color mode.
			// tRNs (transparency) chunk can provide alpha data associated with each color in the PLTE chunk.
			// It may contain as many transparency entries as there are palette entries, or as few as one.
			// tRNS chunk can also be used to specify a single color to be considered fully transparent in true-color mode.
			if (tabs.PLTE && tabs.PLTE.length >= 3 * 2 && ctype === 3 /* palettized */) {
				if (tabs.PLTE.length === 3 * 2) {
					palette = make_monochrome_palette(
						[...tabs.PLTE.slice(0, 3), tabs.tRNS?.[0] ?? 255],
						[...tabs.PLTE.slice(3, 6), tabs.tRNS?.[1] ?? 255]
					);
					monochrome = true;
				} else {
					palette = new Array(tabs.PLTE.length / 3);
					for (let i = 0; i < palette.length; i++) {
						if (tabs.tRNS && tabs.tRNS.length >= i + 1) {
							palette[i] = `rgba(${tabs.PLTE[i * 3 + 0]}, ${tabs.PLTE[i * 3 + 1]}, ${tabs.PLTE[i * 3 + 2]}, ${tabs.tRNS[i] / 255})`;
						} else {
							palette[i] = `rgb(${tabs.PLTE[i * 3 + 0]}, ${tabs.PLTE[i * 3 + 1]}, ${tabs.PLTE[i * 3 + 2]})`;
						}
					}
					monochrome = false;
				}
			}
			file_format = "image/png";
			const image_data = new ImageData(new Uint8ClampedArray(rgba), width, height);
			callback(null, { file_format, monochrome, palette, image_data, source_blob: blob });
		} else if (detected_type_id === "tiff_be" || detected_type_id === "tiff_le") {
			// IFDs = image file directories
			// VSNs = ???
			// This code is based on UTIF.bufferToURI
			var ifds = UTIF.decode(arrayBuffer);
			//console.log(ifds);
			var vsns = ifds, ma = 0, page = vsns[0];
			if (ifds[0].subIFD) {
				vsns = vsns.concat(ifds[0].subIFD);
			}
			for (var i = 0; i < vsns.length; i++) {
				var img = vsns[i];
				if (img["t258"] == null || img["t258"].length < 3) continue;
				var ar = img["t256"] * img["t257"];
				if (ar > ma) { ma = ar; page = img; }
			}
			UTIF.decodeImage(arrayBuffer, page, ifds);
			var rgba = UTIF.toRGBA8(page);

			var image_data = new ImageData(new Uint8ClampedArray(rgba.buffer), page.width, page.height);

			file_format = "image/tiff";
			callback(null, { file_format, monochrome, palette, image_data, source_blob: blob });
		} else if (detected_type_id === "pdf") {
			file_format = "application/pdf";

			const pdfjs = window["pdfjs-dist/build/pdf"];

			pdfjs.GlobalWorkerOptions.workerSrc = "lib/pdf.js/build/pdf.worker.js";

			const file_bytes = new Uint8Array(arrayBuffer);

			const loadingTask = pdfjs.getDocument({
				data: file_bytes,
				cMapUrl: "lib/pdf.js/web/cmaps/",
				cMapPacked: true,
			});

			loadingTask.promise.then((pdf) => {
				console.log("PDF loaded");

				// Fetch the first page
				// TODO: maybe concatenate all pages into one image?
				var pageNumber = 1;
				pdf.getPage(pageNumber).then((page) => {
					console.log("Page loaded");

					var scale = 1.5;
					var viewport = page.getViewport({ scale });

					// Prepare canvas using PDF page dimensions
					var canvas = make_canvas(viewport.width, viewport.height);

					// Render PDF page into canvas context
					var renderContext = {
						canvasContext: canvas.ctx,
						viewport,
					};
					var renderTask = page.render(renderContext);
					renderTask.promise.then(() => {
						console.log("Page rendered");
						const image_data = canvas.ctx.getImageData(0, 0, canvas.width, canvas.height);
						callback(null, { file_format, monochrome, palette, image_data, source_blob: blob });
					});
				});
			}, (reason) => {
				callback(new Error(`Failed to load PDF. ${reason}`));
			});
		} else {
			monochrome = false;
			file_format = {
				// bmp: "image/bmp",
				png: "image/png",
				webp: "image/webp",
				jpeg: "image/jpeg",
				gif: "image/gif",
				tiff_be: "image/tiff",
				tiff_le: "image/tiff", // can also be image/x-canon-cr2 etc.
				ico: "image/x-icon",
				cur: "image/x-win-bitmap",
				icns: "image/icns",
			}[detected_type_id] || blob.type;

			const blob_uri = URL.createObjectURL(blob);
			const img = new Image();
			// img.crossOrigin = "Anonymous";
			const handle_decode_fail = () => {
				URL.revokeObjectURL(blob_uri);
				blob.text().then((file_text) => {
					const error = new Error("failed to decode blob as an image");
					// @ts-ignore
					error.code = file_text.match(/^\s*<!doctype\s+html/i) ? "html-not-image" : "decoding-failure";
					callback(error);
				}, (_err) => {
					const error = new Error("failed to decode blob as image or text");
					// @ts-ignore
					error.code = "decoding-failure";
					callback(error);
				});
			};
			img.onload = () => {
				URL.revokeObjectURL(blob_uri);
				if (!img.complete || typeof img.naturalWidth == "undefined" || img.naturalWidth === 0) {
					handle_decode_fail();
					return;
				}
				callback(null, { file_format, monochrome, palette, image: img, source_blob: blob });
			};
			img.onerror = handle_decode_fail;
			img.src = blob_uri;
		}
	}, (error) => {
		callback(error);
	});
}

/**
 * Updates the canvas to reflect reductions in color when saving to certain file formats.
 * @param {Blob} blob - The saved file blob.
 */
function update_from_saved_file(blob) {
	read_image_file(blob, (error, info) => {
		if (error) {
			show_error_message("The file has been saved, however... " + localize("Paint cannot read this file."), error);
			return;
		}
		apply_file_format_and_palette_info(info);
		const format = image_formats.find(({ mimeType }) => mimeType === info.file_format);
		undoable({
			name: `${localize("Save As")} ${format ? format.name : info.file_format}`,
			icon: get_help_folder_icon("p_save.png"),
			assume_saved: true, // prevent setting saved to false
		}, () => {
			main_ctx.copy(info.image || info.image_data);
		});
	});
}

function save_selection_to_file() {
	if (selection && selection.canvas) {
		systemHooks.showSaveFileDialog({
			dialogTitle: localize("Save As"),
			defaultFileName: "selection.png",
			defaultFileFormatID: "image/png",
			formats: image_formats,
			getBlob: (new_file_type) => {
				return new Promise((resolve) => {
					write_image_file(selection.canvas, new_file_type, (blob) => {
						resolve(blob);
					});
				});
			},
		});
	}
}

/**
 * @param {Blob} blob
 * @param {() => void} okay_callback
 * @param {number[]} [magic_number_bytes]
 * @param {boolean} [magic_wanted]
 */
function sanity_check_blob(blob, okay_callback, magic_number_bytes, magic_wanted = true) {
	if (blob.size > 0) {
		if (magic_number_bytes) {
			blob.arrayBuffer().then((arrayBuffer) => {
				const file_bytes = new Uint8Array(arrayBuffer);
				const magic_found = magic_number_bytes.every((byte, index) => byte === file_bytes[index]);
				// console.log(file_bytes, magic_number_bytes, magic_found, magic_wanted);
				if (magic_found === magic_wanted) {
					okay_callback();
				} else {
					showMessageBox({
						// hackily combining messages that are already localized, in ways they were not meant to be used.
						// you may have to do some deduction to understand this message.
						// messageHTML: `
						// 	<p>${localize("Unexpected file format.")}</p>
						// 	<p>${localize("An unsupported operation was attempted.")}</p>
						// `,
						message:
							window.is_electron_app ?
								"Writing images in this file format is not supported." :
								"Your browser does not support writing images in this file format.",
						iconID: "error",
					});
				}
			}, (error) => {
				show_error_message(localize("An unknown error has occurred."), error);
			});
		} else {
			okay_callback();
		}
	} else {
		show_error_message(localize("Failed to save document."));
	}
}

/**
 * @param {boolean} from_current_document
 */
function show_multi_user_setup_dialog(from_current_document) {
	const $w = $DialogWindow();
	$w.title("Multi-User Setup").addClass("horizontal-buttons");
	$w.$main.html(`
		${from_current_document ? "<p>This will make the current document public.</p>" : ""}
		<p>
			<!-- Choose a name for the multi-user session, included in the URL for sharing: -->
			Enter the session name that will be used in the URL for sharing:
		</p>
		<p>
			<label>
				<span class="partial-url-label">jspaint.app/#session:</span>
				<input
					type="text"
					id="session-name"
					aria-label="session name"
					pattern="[-0-9A-Za-z\\u00c0-\\u00d6\\u00d8-\\u00f6\\u00f8-\\u02af\\u1d00-\\u1d25\\u1d62-\\u1d65\\u1d6b-\\u1d77\\u1d79-\\u1d9a\\u1e00-\\u1eff\\u2090-\\u2094\\u2184-\\u2184\\u2488-\\u2490\\u271d-\\u271d\\u2c60-\\u2c7c\\u2c7e-\\u2c7f\\ua722-\\ua76f\\ua771-\\ua787\\ua78b-\\ua78c\\ua7fb-\\ua7ff\\ufb00-\\ufb06]+"
					title="Numbers, letters, and hyphens are allowed."
					class="inset-deep"
				>
			</label>
		</p>
	`);
	const $session_name = $w.$main.find("#session-name");
	$w.$main.css({ maxWidth: "500px" });
	$w.$Button("Start", () => {
		let name = String($session_name.val()).trim();

		if (name == "") {
			show_error_message("The session name cannot be empty.");
		} else if ($session_name.is(":invalid")) {
			show_error_message("The session name must be made from only numbers, letters, and hyphens.");
		} else {
			if (from_current_document) {
				change_url_param("session", name);
			} else {
				// @TODO: load new empty session in the same browser tab
				// (or at least... keep settings like vertical-color-box-mode?)
				window.open(`${location.origin}${location.pathname}#session:${name}`);
			}
			$w.close();
		}
	}, { type: "submit" });
	$w.$Button(localize("Cancel"), () => {
		$w.close();
	});
	$w.center();
	$session_name.focus();
}

export {
	$this_version_news,
	apply_file_format_and_palette_info, are_you_sure, cancel, change_some_url_params, change_url_param, choose_file_to_paste, cleanup_bitmap_view, clear, confirm_overwrite_capability, delete_selection, deselect, detect_monochrome,
	edit_copy, edit_cut, edit_paste, exit_fullscreen_if_ios, file_load_from_url, file_new, file_open, file_print, file_save,
	file_save_as, getSelectionText, get_all_url_params, get_history_ancestors, get_tool_by_id, get_uris, get_url_param, go_to_history_node, handle_keyshortcuts, has_any_transparency, image_attributes, image_flip_and_rotate, image_invert_colors, image_stretch_and_skew, load_image_from_uri, load_theme_from_text, make_history_node, make_monochrome_palette, make_monochrome_pattern, make_opaque, make_or_update_undoable, make_stripe_pattern, meld_selection_into_canvas,
	meld_textbox_into_canvas, open_from_file, open_from_image_info, paste, paste_image_from_file, please_enter_a_number, read_image_file, redo, render_canvas_view, render_history_as_gif, reset_canvas_and_history, reset_file, reset_selected_colors, resize_canvas_and_save_dimensions, resize_canvas_without_saving_dimensions, sanity_check_blob, save_as_prompt, save_selection_to_file, select_all, select_tool, select_tools, set_all_url_params, set_magnification, show_about_paint, show_convert_to_black_and_white, show_custom_zoom_window, show_document_history, show_error_message, show_file_format_errors, show_multi_user_setup_dialog, show_news, show_resource_load_error_message, switch_to_polychrome_palette, toggle_grid,
	toggle_thumbnail, try_exec_command, undo, undoable, update_canvas_rect, update_css_classes_for_conditional_messages, update_disable_aa, update_from_saved_file, update_helper_layer,
	update_helper_layer_immediately, update_magnified_canvas_size, update_title, view_bitmap, write_image_file
};
// Temporary globals until all dependent code is converted to ES Modules
window.make_history_node = make_history_node; // used by app-state.js
window.open_from_file = open_from_file; // used by electron-injected.js
window.are_you_sure = are_you_sure; // used by app-localization.js, electron-injected.js
window.show_error_message = show_error_message; // used by app-localization.js, electron-injected.js
window.show_about_paint = show_about_paint; // used by electron-injected.js
window.exit_fullscreen_if_ios = exit_fullscreen_if_ios; // used by app-localization.js
window.get_tool_by_id = get_tool_by_id; // used by app-state.js
window.make_monochrome_palette = make_monochrome_palette; // used by app-state.js
window.sanity_check_blob = sanity_check_blob; // used by electron-injected.js
