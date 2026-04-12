// The 'test_default_test' test program.
import default_test.aleo;
program test_default_test.aleo {
    @test
    @should_fail
    fn test_main_fails() {
        let result: u32 = default_test.aleo::main(2u32, 3u32);
        assert_eq(result, 3u32);
    }

    @noupgrade
    constructor() {}
}
