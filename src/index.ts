import formatTitle from '@directus/format-title';
import path from 'path';
import { defineEndpoint } from '@directus/extensions-sdk';
import Busboy from 'busboy';
import { Stream } from 'stream';

export default defineEndpoint((router, { services, exceptions }) => {

	const { FilesService, ItemsService, UsersService } = services;
	const { ServiceUnavailableException, InvalidQueryException } = exceptions;


	router.post('/', async (req, res, next) => {
		try {
			const busboy = new Busboy({ headers: req.headers });
			const files = new FilesService({ accountability: req.accountability, schema: req.schema });
			const users = new UsersService({ accountability: req.accountability, schema: req.schema });
			const notes = new ItemsService('notes', { accountability: req.accountability, schema: req.schema });
			let sentBy: string;
			let ocrTextBuffer: Buffer;
			let pdfFileBuffer: Buffer;
			let pdfFileName: string;

			busboy.on('file', (_fieldname: string, file: Stream, filename: string, _encoding: string, mimetype: string) => {
				file.on('data', async data => {
					if (mimetype === "text/plain") {
						if (ocrTextBuffer === undefined) {
							ocrTextBuffer = data;
						} else {
							ocrTextBuffer = Buffer.concat([ocrTextBuffer, data]);
						}
					} else {
						if (pdfFileBuffer === undefined) {
							pdfFileBuffer = data;
							pdfFileName = filename;
						} else {
							pdfFileBuffer = Buffer.concat([pdfFileBuffer, data]);
						}
					}
				});
			});

			busboy.on('field', (name: string, val: string) => {
				if (name === 'headers') {
					const regex = /Reply-To:.*\<(.*)\>/gm
					const matches = regex.exec(val);
					if (matches === null || !Array.isArray(matches) || !matches[1]) {
						return next(new InvalidQueryException('Reply-To header not found'));
					} else {
						sentBy = matches[1];
					}
				}
			})
			busboy.on('finish', async () => {
				if (!sentBy) {
					return next(new InvalidQueryException('Reply-To header not found'));
				}
				try {
					const user = await users.readByQuery({ filter: { email: sentBy }, limit: 1 })
					if (!user.length) {
						return next(new InvalidQueryException('User not found'));
					}
					const { id } = user[0];
					let ocrText: string = "";
					if (ocrTextBuffer) {
						ocrText = ocrTextBuffer.toString();
					}
					const file = await files.uploadOne(pdfFileBuffer, { storage: 's3', filename_download: pdfFileName, uploaded_by: id, type: 'application/pdf', title: formatTitle(path.parse(pdfFileName).name) });
					const note = await notes.createOne({
						title: formatTitle(path.parse(pdfFileName).name),
						ocr: ocrText,
						original_scan: file,
						from_user: sentBy
					})
					console.log(note)
					res.json({
						status: 200,
						message: 'Files uploaded successfully',
					})
				} catch (e) {
					console.log(e)
					return next(new ServiceUnavailableException('Unable to upload file'));
				}
			});
			req.pipe(busboy);
		} catch (error: any) {
			return next(new InvalidQueryException(error.message));
		};
	});
});

