#include <stdio.h>

int main() {
	printf("Enter name: ");
	char name[100];
	scanf("%s", name);
	printf("Hello %s!\n", name);
	return 0;
}
