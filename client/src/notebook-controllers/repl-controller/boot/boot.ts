import { encodeBase64 } from "jsr:@std/encoding/base64";


globalThis.Deno.jupyter = (function () {

	const $display = Symbol.for("Jupyter.display");

	const _displayFunc = async (obj: unknown, options: Deno.jupyter.DisplayOptions = { raw: true }): Promise<void> => {
		let data = (obj as any)[$display] ? (await ((obj as any)[$display])()) : obj;
		if (!options.raw) {
			data = JSON.stringify(data);
		}
		console.log(`##DISPLAYDATA#2d522e5a-4a6c-4aae-b20c-91c5189948d9##${JSON.stringify(data)}`);
	}

	function makeDisplayable(obj: unknown): Deno.jupyter.Displayable {
		return { [$display]: () => obj } as any;
	}

	function createTaggedTemplateDisplayable(mediatype: string) {
		return (strings: TemplateStringsArray, ...values: unknown[]) => {
			const payload = strings.reduce(
				(acc, string, i) =>
					acc + string + (values[i] !== undefined ? values[i] : ""),
				"",
			);
			return makeDisplayable({ [mediatype]: payload });
		};
	}


	function isJpg(obj: any) {
		// Check if obj is a Uint8Array
		if (!(obj instanceof Uint8Array)) {
			return false;
		}

		// JPG files start with the magic bytes FF D8
		if (obj.length < 2 || obj[0] !== 0xFF || obj[1] !== 0xD8) {
			return false;
		}

		// JPG files end with the magic bytes FF D9
		if (
			obj.length < 2 || obj[obj.length - 2] !== 0xFF ||
			obj[obj.length - 1] !== 0xD9
		) {
			return false;
		}

		return true;
	}

	function isPng(obj: any) {
		// Check if obj is a Uint8Array
		if (!(obj instanceof Uint8Array)) {
			return false;
		}

		// PNG files start with a specific 8-byte signature
		const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

		// Check if the array is at least as long as the signature
		if (obj.length < pngSignature.length) {
			return false;
		}

		// Check each byte of the signature
		for (let i = 0; i < pngSignature.length; i++) {
			if (obj[i] !== pngSignature[i]) {
				return false;
			}
		}

		return true;
	}



	const _mdFunc = createTaggedTemplateDisplayable("text/markdown");
	const _svgFunc = createTaggedTemplateDisplayable("image/svg+xml");
	const _htmlFunc = createTaggedTemplateDisplayable("text/html");
	const _imageFunc = (obj: any) => {
		if (typeof obj === "string") {
			try {
				obj = Deno.readFileSync(obj);
			} catch {
				// pass
			}
		}

		if (isJpg(obj)) {
			return makeDisplayable({ "image/jpeg": encodeBase64(obj) });
		}

		if (isPng(obj)) {
			return makeDisplayable({ "image/png": encodeBase64(obj) });
		}

		throw new TypeError(
			"Object is not a valid image or a path to an image. `Deno.jupyter.image` supports displaying JPG or PNG images.",
		);
	}

	return {
		$display: $display as any as (typeof Deno.jupyter.$display),
		display: _displayFunc,
		md: _mdFunc,
		svg: _svgFunc,
		html: _htmlFunc,
		image: _imageFunc
	}

})();
