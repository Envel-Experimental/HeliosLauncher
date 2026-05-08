const { LogBatcher } = require('../../../../../../../app/assets/js/core/util/LogBatcher')

describe('LogBatcher Enterprise', () => {
    let mockOnFlush
    let batcher

    beforeEach(() => {
        mockOnFlush = jest.fn()
        jest.useFakeTimers()
    })

    afterEach(() => {
        if (batcher) batcher.destroy()
        jest.useRealTimers()
    })

    test('should aggregate multiple calls into one flush', () => {
        batcher = new LogBatcher(mockOnFlush, 150)
        batcher.enqueue('Alpha')
        batcher.enqueue('Beta')
        
        expect(mockOnFlush).not.toHaveBeenCalled()
        
        jest.advanceTimersByTime(150)
        expect(mockOnFlush).toHaveBeenCalledWith('AlphaBeta')
    })

    test('should force flush when size limit reached', () => {
        batcher = new LogBatcher(mockOnFlush, 150, 10)
        batcher.enqueue('123456')
        batcher.enqueue('789012') // Total 12 > 10
        
        expect(mockOnFlush).toHaveBeenCalledWith('3456789012') // Last 10 chars due to cap
    })

    test('should flush remaining logs on explicit flush call', () => {
        batcher = new LogBatcher(mockOnFlush, 150)
        batcher.enqueue('Test')
        batcher.flush()
        
        expect(mockOnFlush).toHaveBeenCalledWith('Test')
        expect(batcher.timer).toBeNull()
    })

    test('should handle destruction cleanly', () => {
        batcher = new LogBatcher(mockOnFlush, 150)
        batcher.enqueue('Data')
        batcher.destroy()
        
        jest.advanceTimersByTime(150)
        expect(mockOnFlush).not.toHaveBeenCalled()
    })
})
