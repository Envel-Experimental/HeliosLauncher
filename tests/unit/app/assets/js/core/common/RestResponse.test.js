const { RestResponseStatus, isDisplayableError, handleFetchError } = require('@app/assets/js/core/common/RestResponse');

describe('RestResponse', () => {

    describe('isDisplayableError', () => {
        it('should return true for object with title and desc', () => {
            const error = { title: 'Error', desc: 'Description' };
            expect(isDisplayableError(error)).toBe(true);
        });

        it('should return false for null', () => {
            expect(isDisplayableError(null)).toBe(false);
        });

        it('should return false for object without title', () => {
            const error = { desc: 'Description' };
            expect(isDisplayableError(error)).toBe(false);
        });

        it('should return false for object without desc', () => {
            const error = { title: 'Error' };
            expect(isDisplayableError(error)).toBe(false);
        });

        it('should return false for non-object', () => {
            expect(isDisplayableError('error')).toBe(false);
        });
    });

    describe('handleFetchError', () => {
        const mockLogger = {
            error: jest.fn()
        };

        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('should return response with serialized error', async () => {
            const error = new Error('Test error');
            error.code = 'TEST_CODE';

            const response = await handleFetchError('TestOp', error, mockLogger);

            expect(response.responseStatus).toBe(RestResponseStatus.ERROR);
            expect(response.error.message).toBe('Test error');
            expect(response.error.code).toBe('TEST_CODE');
            expect(response.data).toBeNull();
            expect(mockLogger.error).toHaveBeenCalledWith('Error during TestOp', error);
        });

        it('should use dataProvider if provided', async () => {
            const error = new Error('Test error');
            const dataProvider = jest.fn().mockReturnValue({ existing: 'data' });

            const response = await handleFetchError('TestOp', error, mockLogger, dataProvider);

            expect(response.data).toEqual({ existing: 'data' });
            expect(dataProvider).toHaveBeenCalled();
        });

        it('should handle non-Error objects', async () => {
            const error = { custom: 'error' };

            const response = await handleFetchError('TestOp', error, mockLogger);

            expect(response.error).toEqual(error);
        });
    });

});
